export type NormRect = { x: number; y: number; w: number; h: number };

export const FULL: NormRect = { x: 0, y: 0, w: 1, h: 1 };

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.4;

export function clampZoom(zoom: number, follow: boolean): number {
  return Math.min(MAX_ZOOM, Math.max(follow ? MIN_ZOOM : 1, zoom));
}

export function detectTarget(image: { width: number; height: number; data: Uint8ClampedArray }): NormRect | null {
  const { width: w, height: h, data: px } = image;
  if (w < 8 || h < 8) return null;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  }

  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.08));
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < margin || y < margin || x >= w - margin || y >= h - margin) border.push(gray[y * w + x]);
    }
  }
  border.sort((a, b) => a - b);
  const bg = border[border.length >> 1] ?? 128;

  let mask = new Uint8Array(w * h) as Uint8Array<ArrayBufferLike>;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = gray[i];
      let max = g;
      let min = g;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = gray[i + dy * w + dx];
          if (v > max) max = v;
          if (v < min) min = v;
        }
      }
      if (Math.abs(g - bg) > 20 || max - min > 26) mask[i] = 1;
    }
  }
  mask = dilate(dilate(mask, w, h), w, h);

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let bestArea = 0;
  let box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack[sp++] = p - 1;
      }
      if (x + 1 < w && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack[sp++] = p + 1;
      }
      if (p - w >= 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack[sp++] = p - w;
      }
      if (p + w < w * h && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack[sp++] = p + w;
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const fill = area / (bw * bh);
    if (area > bestArea && fill > 0.38 && bw > w * 0.18 && bh > h * 0.18) {
      bestArea = area;
      box = { x0, y0, x1, y1 };
    }
  }
  if (!bestArea) return null;

  const rw = (box.x1 - box.x0 + 1) / w;
  const rh = (box.y1 - box.y0 + 1) / h;
  if (rw > 0.92 && rh > 0.92) return null;

  const padX = Math.max(0.045, rw * 0.08);
  const padY = Math.max(0.045, rh * 0.08);
  const x = Math.max(0, box.x0 / w - padX);
  const y = Math.max(0, box.y0 / h - padY);
  const x2 = Math.min(1, (box.x1 + 1) / w + padX);
  const y2 = Math.min(1, (box.y1 + 1) / h + padY);
  return { x, y, w: x2 - x, h: y2 - y };
}

export function smoothLock(prev: NormRect | null, next: NormRect | null): NormRect {
  if (!next) return prev ?? FULL;
  if (!prev || (prev.w > 0.98 && prev.h > 0.98)) return next;

  let target = next;
  const prevArea = prev.w * prev.h;
  const nextArea = next.w * next.h;
  if (nextArea > prevArea * 1.75) {
    target = {
      x: prev.x + (next.x - prev.x) * 0.35,
      y: prev.y + (next.y - prev.y) * 0.35,
      w: prev.w + (next.w - prev.w) * 0.35,
      h: prev.h + (next.h - prev.h) * 0.35,
    };
  }

  const dcx = Math.abs(target.x + target.w / 2 - (prev.x + prev.w / 2));
  const dcy = Math.abs(target.y + target.h / 2 - (prev.y + prev.h / 2));
  const ds = Math.abs(target.w - prev.w) + Math.abs(target.h - prev.h);
  if (dcx < 0.02 && dcy < 0.02 && ds < 0.05) return prev;

  let x1 = prev.x;
  let y1 = prev.y;
  let x2 = prev.x + prev.w;
  let y2 = prev.y + prev.h;
  const tx2 = target.x + target.w;
  const ty2 = target.y + target.h;
  const escaped = target.x < x1 - 0.004 || target.y < y1 - 0.004 || tx2 > x2 + 0.004 || ty2 > y2 + 0.004;
  if (escaped) {
    x1 = Math.min(x1, target.x);
    y1 = Math.min(y1, target.y);
    x2 = Math.max(x2, tx2);
    y2 = Math.max(y2, ty2);
  }
  const t = escaped ? 0.5 : 0.2;
  x1 += (target.x - x1) * t;
  y1 += (target.y - y1) * t;
  x2 += (tx2 - x2) * t;
  y2 += (ty2 - y2) * t;
  return clampRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
}

export function applyZoom(frame: NormRect, zoom: number): NormRect {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const w = Math.min(1, Math.max(0.28, frame.w / z));
  const h = Math.min(1, Math.max(0.28, frame.h / z));
  let x = cx - w / 2;
  let y = cy - h / 2;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  return { x, y, w, h };
}

export function placeVideo(video: HTMLVideoElement, finder: HTMLElement, crop: NormRect, mirror: boolean) {
  const fw = finder.clientWidth;
  const fh = finder.clientHeight;
  if (!fw || !fh || !video.videoWidth || !video.videoHeight) return;
  const scale = Math.min(fw / (crop.w * video.videoWidth), fh / (crop.h * video.videoHeight));
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  video.style.width = `${width}px`;
  video.style.height = `${height}px`;
  video.style.left = `${(fw - crop.w * video.videoWidth * scale) / 2 - crop.x * video.videoWidth * scale}px`;
  video.style.top = `${(fh - crop.h * video.videoHeight * scale) / 2 - crop.y * video.videoHeight * scale}px`;
  video.style.right = "auto";
  video.style.bottom = "auto";
  video.style.objectFit = "fill";
  video.style.transform = mirror ? "scaleX(-1)" : "none";
}

function clampRect(rect: NormRect): NormRect {
  const w = Math.min(1, Math.max(0.2, rect.w));
  const h = Math.min(1, Math.max(0.2, rect.h));
  const x = Math.min(1 - w, Math.max(0, rect.x));
  const y = Math.min(1 - h, Math.max(0, rect.y));
  return { x, y, w, h };
}

function dilate(mask: Uint8Array<ArrayBufferLike>, w: number, h: number): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w]) out[i] = 1;
    }
  }
  return out;
}
