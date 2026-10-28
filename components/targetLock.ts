export type NormRect = { x: number; y: number; w: number; h: number };

export const FULL: NormRect = { x: 0, y: 0, w: 1, h: 1 };

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const FILLED = "filled" as const;

type Box = { x0: number; y0: number; x1: number; y1: number };
type Find = NormRect | typeof FILLED | null;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function frameOnTarget(target: NormRect, userZoom: number): NormRect {
  const padX = Math.min(0.04, Math.max(0.014, target.w * 0.06));
  const padY = Math.min(0.04, Math.max(0.014, target.h * 0.06));
  const z = clampZoom(userZoom);
  let w = Math.min(1, target.w + padX * 2);
  let h = Math.min(1, target.h + padY * 2);
  if (z > 1) {
    w = Math.max(1 / MAX_ZOOM, w / z);
    h = Math.max(1 / MAX_ZOOM, h / z);
  }
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  return { x, y, w, h };
}

export function frameAtZoom(zoom: number, center?: { x: number; y: number }): NormRect {
  const z = clampZoom(zoom);
  const w = 1 / z;
  const h = 1 / z;
  const cx = center?.x ?? 0.5;
  const cy = center?.y ?? 0.5;
  let x = cx - w / 2;
  let y = cy - h / 2;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  return { x, y, w, h };
}

export function detectTarget(image: { width: number; height: number; data: Uint8ClampedArray }): NormRect | null {
  const { width: w, height: h, data: px } = image;
  if (w < 8 || h < 8 || px.length < w * h * 4) return null;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0;
  }
  const grid = buildGrid(gray, w, h);
  const panel = findPanel(grid, w, h);
  if (panel === FILLED) return FULL;
  if (panel) return panel;
  const ink = findInk(w, h, grid);
  if (ink === FILLED) return FULL;
  return ink;
}

export function pageShift(
  prev: Uint8Array | null,
  image: { width: number; height: number; data: Uint8ClampedArray },
  delta = 32,
) {
  const { width: w, height: h, data: px } = image;
  const gray = new Uint8Array(w * h);
  let changed = 0;
  for (let i = 0; i < w * h; i++) {
    const g = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0;
    gray[i] = g;
    if (prev && prev.length === gray.length && Math.abs(g - prev[i]) > delta) changed += 1;
  }
  const ratio = prev && prev.length === gray.length ? changed / gray.length : 0;
  return { gray, ratio };
}

export function smoothLock(prev: NormRect | null, next: NormRect | null): NormRect {
  if (!next) return prev ?? FULL;
  if (!prev || (prev.w > 0.98 && prev.h > 0.98)) return next;
  const dcx = Math.abs(next.x + next.w / 2 - (prev.x + prev.w / 2));
  const dcy = Math.abs(next.y + next.h / 2 - (prev.y + prev.h / 2));
  const ds = Math.abs(next.w - prev.w) + Math.abs(next.h - prev.h);
  if (dcx < 0.02 && dcy < 0.02 && ds < 0.045) return prev;
  const areaRatio = (next.w * next.h) / Math.max(1e-4, prev.w * prev.h);
  const t = areaRatio > 1.35 ? 0.42 : areaRatio < 0.7 || dcx + dcy > 0.25 ? 0.16 : 0.34;
  return clampRect({
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
    w: prev.w + (next.w - prev.w) * t,
    h: prev.h + (next.h - prev.h) * t,
  });
}

export function medianRect(samples: NormRect[]): NormRect {
  if (!samples.length) return FULL;
  if (samples.length === 1) return samples[0];
  const pick = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = (sorted.length - 1) / 2;
    return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
  };
  const x = pick(samples.map((rect) => rect.x));
  const y = pick(samples.map((rect) => rect.y));
  const x2 = pick(samples.map((rect) => rect.x + rect.w));
  const y2 = pick(samples.map((rect) => rect.y + rect.h));
  return clampRect({ x, y, w: x2 - x, h: y2 - y });
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
  video.style.objectFit = "contain";
  video.style.transform = mirror ? "scaleX(-1)" : "none";
}

type Grid = {
  cols: number;
  rows: number;
  means: Float64Array;
  energy: Float64Array;
  sum: Float64Array;
  sq: Float64Array;
  grad: Float64Array;
  count: Float64Array;
};

function findPanel(grid: Grid, w: number, h: number): Find {
  const { cols, rows } = grid;
  const totalN = areaSum(grid.count, cols, 0, 0, cols - 1, rows - 1);
  const totalSum = areaSum(grid.sum, cols, 0, 0, cols - 1, rows - 1);
  if (totalN < 16) return null;
  let bestScore = 0;
  let best: Box | null = null;
  const minSide = 2;
  for (let y0 = 0; y0 < rows; y0++) {
    for (let y1 = y0 + minSide - 1; y1 < rows; y1++) {
      for (let x0 = 0; x0 < cols; x0++) {
        for (let x1 = x0 + minSide - 1; x1 < cols; x1++) {
          const rw = (x1 - x0 + 1) / cols;
          const rh = (y1 - y0 + 1) / rows;
          if (rw < 0.11 || rh < 0.11 || rw / rh > 7 || rh / rw > 7) continue;
          if (rw > 0.97 && rh > 0.97) continue;
          let touched = 0;
          if (x0 === 0) touched++;
          if (y0 === 0) touched++;
          if (x1 === cols - 1) touched++;
          if (y1 === rows - 1) touched++;
          if (touched >= 3) continue;
          const insideN = areaSum(grid.count, cols, x0, y0, x1, y1);
          const outsideN = totalN - insideN;
          if (insideN < 12 || outsideN < totalN * 0.02) continue;
          const insideMean = areaSum(grid.sum, cols, x0, y0, x1, y1) / insideN;
          const outsideMean = (totalSum - areaSum(grid.sum, cols, x0, y0, x1, y1)) / outsideN;
          const insideSq = areaSum(grid.sq, cols, x0, y0, x1, y1);
          const variance = Math.max(0, insideSq / insideN - insideMean * insideMean);
          const insideEnergy = areaSum(grid.grad, cols, x0, y0, x1, y1) / insideN;
          const area = rw * rh;
          const dist = Math.hypot((x0 + x1) / 2 / cols - 0.5, (y0 + y1) / 2 / rows - 0.5);
          const place = 1 - Math.min(0.7, dist * 0.5);
          const bright = insideMean - outsideMean;
          if (bright >= 15) {
            const agree = edgeAgreement(grid.means, cols, rows, x0, y0, x1, y1, true);
            if (agree >= 0.5) {
              const penalty = 1 + Math.max(0, variance - 900) / 3200;
              const score = (bright * Math.sqrt(area) * place * (0.55 + agree)) / penalty;
              if (score > bestScore) {
                bestScore = score;
                best = { x0, y0, x1, y1 };
              }
            }
          }
          const dark = outsideMean - insideMean;
          let darkEnergy = insideEnergy;
          if (x1 - x0 >= 2 && y1 - y0 >= 2) {
            const coreN = areaSum(grid.count, cols, x0 + 1, y0 + 1, x1 - 1, y1 - 1);
            if (coreN > 8) darkEnergy = areaSum(grid.grad, cols, x0 + 1, y0 + 1, x1 - 1, y1 - 1) / coreN;
          }
          if (dark >= 12 && darkEnergy >= 6) {
            const agree = edgeAgreement(grid.means, cols, rows, x0, y0, x1, y1, false);
            if (agree >= 0.48) {
              const score = dark * Math.sqrt(area) * place * (0.55 + agree);
              if (score > bestScore) {
                bestScore = score;
                best = { x0, y0, x1, y1 };
              }
            }
          }
        }
      }
    }
  }
  if (!best || bestScore < 4.2) return null;
  return boxToRect(best, grid, w, h, 1);
}

function findInk(w: number, h: number, grid: Grid): Find {
  const { cols, rows, energy, means } = grid;
  const values = Array.from(energy).sort((a, b) => a - b);
  const p70 = values[Math.floor(values.length * 0.7)] ?? 0;
  if (p70 < 4 && (values[values.length - 1] ?? 0) < 10) return null;
  const cut = Math.max(8, p70);
  const marked = new Uint8Array(cols * rows);
  let marks = 0;
  for (let i = 0; i < energy.length; i++) {
    if (energy[i] >= cut) {
      marked[i] = 1;
      marks++;
    }
  }
  if (marks < 6) return null;
  if (marks > cols * rows * 0.86) return FILLED;
  const grown = dilateCells(marked, cols, rows);
  const box = largestCellRun(grown, cols, rows);
  if (!box) return null;
  const tone = medianCells(means, cols, box);
  let guard = cols + rows;
  let current = box;
  while (guard-- > 0) {
    let next = current;
    let moved = false;
    if (current.y0 > 0 && stripClose(means, cols, current.y0 - 1, current.x0, current.x1, true, tone)) {
      next = { ...next, y0: current.y0 - 1 };
      moved = true;
    }
    if (current.y1 + 1 < rows && stripClose(means, cols, current.y1 + 1, current.x0, current.x1, true, tone)) {
      next = { ...next, y1: current.y1 + 1 };
      moved = true;
    }
    if (current.x0 > 0 && stripClose(means, cols, current.x0 - 1, current.y0, current.y1, false, tone)) {
      next = { ...next, x0: current.x0 - 1 };
      moved = true;
    }
    if (current.x1 + 1 < cols && stripClose(means, cols, current.x1 + 1, current.y0, current.y1, false, tone)) {
      next = { ...next, x1: current.x1 + 1 };
      moved = true;
    }
    if (!moved) break;
    current = next;
  }
  const seedRect = boxToRect(box, grid, w, h, 1);
  const grownRect = boxToRect(current, grid, w, h, 1);
  if (grownRect === FILLED) {
    if (seedRect && seedRect !== FILLED && seedRect.w < 0.86 && seedRect.h < 0.86) return seedRect;
    return null;
  }
  return grownRect;
}

function buildGrid(gray: Uint8Array, w: number, h: number): Grid {
  const cols = Math.max(8, Math.round(w / 4));
  const rows = Math.max(8, Math.round(h / 4));
  const n = cols * rows;
  const sumCell = new Float64Array(n);
  const sqCell = new Float64Array(n);
  const gradCell = new Float64Array(n);
  const countCell = new Float64Array(n);
  const means = new Float64Array(n);
  const energy = new Float64Array(n);
  for (let cy = 0; cy < rows; cy++) {
    const yStart = Math.floor((cy * h) / rows);
    const yEnd = Math.floor(((cy + 1) * h) / rows);
    for (let cx = 0; cx < cols; cx++) {
      const xStart = Math.floor((cx * w) / cols);
      const xEnd = Math.floor(((cx + 1) * w) / cols);
      let sum = 0;
      let sq = 0;
      let grad = 0;
      let count = 0;
      let steps = 0;
      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const g = gray[y * w + x];
          sum += g;
          sq += g * g;
          count++;
          if (x > 0) {
            grad += Math.abs(g - gray[y * w + x - 1]);
            steps++;
          }
          if (y > 0) {
            grad += Math.abs(g - gray[(y - 1) * w + x]);
            steps++;
          }
        }
      }
      const i = cy * cols + cx;
      sumCell[i] = sum;
      sqCell[i] = sq;
      gradCell[i] = grad;
      countCell[i] = count;
      means[i] = count ? sum / count : 0;
      energy[i] = steps ? grad / steps : 0;
    }
  }
  return {
    cols,
    rows,
    means,
    energy,
    sum: prefix(sumCell, cols, rows),
    sq: prefix(sqCell, cols, rows),
    grad: prefix(gradCell, cols, rows),
    count: prefix(countCell, cols, rows),
  };
}

function prefix(values: Float64Array, cols: number, rows: number): Float64Array {
  const stride = cols + 1;
  const out = new Float64Array((rows + 1) * stride);
  for (let y = 0; y < rows; y++) {
    let row = 0;
    for (let x = 0; x < cols; x++) {
      row += values[y * cols + x];
      out[(y + 1) * stride + (x + 1)] = out[y * stride + (x + 1)] + row;
    }
  }
  return out;
}

function areaSum(table: Float64Array, cols: number, x0: number, y0: number, x1: number, y1: number): number {
  const stride = cols + 1;
  return (
    table[(y1 + 1) * stride + (x1 + 1)] -
    table[y0 * stride + (x1 + 1)] -
    table[(y1 + 1) * stride + x0] +
    table[y0 * stride + x0]
  );
}

function edgeAgreement(
  means: Float64Array,
  cols: number,
  rows: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  brighter: boolean,
): number {
  let ok = 0;
  let n = 0;
  const at = (x: number, y: number) => means[y * cols + x];
  const stepOk = (step: number) => (brighter ? step > 6 : step < -6);
  for (let x = x0; x <= x1; x++) {
    if (y0 > 0) {
      n++;
      if (stepOk(at(x, y0) - at(x, y0 - 1))) ok++;
    }
    if (y1 + 1 < rows) {
      n++;
      if (stepOk(at(x, y1) - at(x, y1 + 1))) ok++;
    }
  }
  for (let y = y0; y <= y1; y++) {
    if (x0 > 0) {
      n++;
      if (stepOk(at(x0, y) - at(x0 - 1, y))) ok++;
    }
    if (x1 + 1 < cols) {
      n++;
      if (stepOk(at(x1, y) - at(x1 + 1, y))) ok++;
    }
  }
  return n ? ok / n : 0;
}

function boxToRect(box: Box, grid: Grid, w: number, h: number, padCells: number): Find {
  const x0 = Math.max(0, box.x0 - padCells);
  const y0 = Math.max(0, box.y0 - padCells);
  const x1 = Math.min(grid.cols, box.x1 + 1 + padCells);
  const y1 = Math.min(grid.rows, box.y1 + 1 + padCells);
  const left = Math.floor((x0 * w) / grid.cols) / w;
  const top = Math.floor((y0 * h) / grid.rows) / h;
  const right = Math.floor((x1 * w) / grid.cols) / w;
  const bottom = Math.floor((y1 * h) / grid.rows) / h;
  const rect = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  if (rect.w > 0.97 && rect.h > 0.97) return FILLED;
  if (rect.w < 0.1 || rect.h < 0.1) return null;
  return rect;
}

function largestCellRun(mask: Uint8Array, cols: number, rows: number): Box | null {
  const seen = new Uint8Array(mask.length);
  let best: Box | null = null;
  let bestArea = 0;
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0;
    let x0 = cols;
    let y0 = rows;
    let x1 = 0;
    let y1 = 0;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % cols;
      const y = (p - x) / cols;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack[sp++] = p - 1;
      }
      if (x + 1 < cols && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack[sp++] = p + 1;
      }
      if (p - cols >= 0 && mask[p - cols] && !seen[p - cols]) {
        seen[p - cols] = 1;
        stack[sp++] = p - cols;
      }
      if (p + cols < mask.length && mask[p + cols] && !seen[p + cols]) {
        seen[p + cols] = 1;
        stack[sp++] = p + cols;
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (area >= 6 && area / (bw * bh) >= 0.38 && bw / cols >= 0.12 && bh / rows >= 0.12 && area > bestArea) {
      bestArea = area;
      best = { x0, y0, x1, y1 };
    }
  }
  return best;
}

function dilateCells(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = mask.slice();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y * cols + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < rows && xx < cols) out[yy * cols + xx] = 1;
        }
      }
    }
  }
  return out;
}

function medianCells(means: Float64Array, cols: number, box: Box): number {
  const vals: number[] = [];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) vals.push(means[y * cols + x]);
  }
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1] ?? 0;
}

function stripClose(
  means: Float64Array,
  cols: number,
  fixed: number,
  a: number,
  b: number,
  horizontal: boolean,
  tone: number,
): boolean {
  const vals: number[] = [];
  for (let t = a; t <= b; t++) vals.push(horizontal ? means[fixed * cols + t] : means[t * cols + fixed]);
  vals.sort((p, q) => p - q);
  return Math.abs((vals[vals.length >> 1] ?? tone) - tone) <= 18;
}

function clampRect(rect: NormRect): NormRect {
  const w = Math.min(1, Math.max(0.1, rect.w));
  const h = Math.min(1, Math.max(0.1, rect.h));
  const x = Math.min(1 - w, Math.max(0, rect.x));
  const y = Math.min(1 - h, Math.max(0, rect.y));
  return { x, y, w, h };
}
