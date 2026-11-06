/** Longueur max du côté le plus long — assez haut pour rester net (OCR / détail). */
export const PHOTO_MAX_EDGE = 4096;
/** Qualité JPEG proche d’une appli Photo native. */
export const PHOTO_JPEG_QUALITY = 0.95;

export async function fileToJpeg(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  try {
    return await drawJpeg(bitmap.width, bitmap.height, (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h));
  } finally {
    bitmap.close?.();
  }
}

/**
 * Capture une vraie photo (ImageCapture) quand le navigateur le permet,
 * sinon repli sur la meilleure frame vidéo. Évite le flou / grain du preview.
 */
export async function capturePhoto(options: {
  video: HTMLVideoElement;
  track?: MediaStreamTrack | null;
  finder?: HTMLElement | null;
  /** Recadrage normalisé 0–1 (zoom logiciel / suivi). */
  crop?: { x: number; y: number; w: number; h: number };
  matchFinder?: boolean;
}): Promise<Blob> {
  const video = options.video;
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("La caméra n'est pas prête.");
  }

  const mirror = isMirrored(video);
  const track = options.track ?? trackFromVideo(video);
  const crop = normalizeCrop(options.crop);
  const nearFull = crop.w > 0.97 && crop.h > 0.97 && crop.x < 0.02 && crop.y < 0.02;

  if (track && typeof ImageCapture !== "undefined") {
    try {
      const still = await takeStillBlob(track);
      // Garde le JPEG natif du capteur si on n’a pas besoin de recadrer / miroir
      if (nearFull && !mirror && !options.matchFinder && still.type.startsWith("image/")) {
        return still;
      }
      const bitmap = await createImageBitmap(still);
      try {
        const region = resolveRegion(video, bitmap.width, bitmap.height, {
          ...options,
          crop,
          // Prefer intentional crop over CSS geometry when we have one
          matchFinder: options.matchFinder && !options.crop,
        });
        if (isFullRegion(region, bitmap.width, bitmap.height) && !mirror && still.type.startsWith("image/jpeg")) {
          return still;
        }
        return await renderRegion(bitmap, region, mirror);
      } finally {
        bitmap.close?.();
      }
    } catch {
      /* fallback frame vidéo */
    }
  }

  // iOS / navigateurs sans ImageCapture : prendre plusieurs frames et garder la plus nette
  return bestVideoFrame(video, {
    crop,
    finder: options.finder,
    matchFinder: options.matchFinder && !options.crop,
    mirror,
  });
}

export function frameMatchingView(video: HTMLVideoElement, finder: HTMLElement): Promise<Blob> {
  const region = visibleSource(video, finder);
  if (!region) return frameFromVideo(video);
  const mirror = isMirrored(video);
  return drawJpeg(
    Math.round(region.sw),
    Math.round(region.sh),
    (ctx, width, height) => {
      if (mirror) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, region.sx, region.sy, region.sw, region.sh, 0, 0, width, height);
    },
    PHOTO_MAX_EDGE,
    PHOTO_JPEG_QUALITY,
  );
}

function visibleSource(video: HTMLVideoElement, finder: HTMLElement) {
  const frame = finder.getBoundingClientRect();
  const box = video.getBoundingClientRect();
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!frame.width || !frame.height || !box.width || !box.height || !sourceWidth || !sourceHeight) return null;
  const left = Math.max(frame.left, box.left);
  const top = Math.max(frame.top, box.top);
  const right = Math.min(frame.right, box.right);
  const bottom = Math.min(frame.bottom, box.bottom);
  const viewWidth = right - left;
  const viewHeight = bottom - top;
  if (viewWidth < 2 || viewHeight < 2) return null;

  const fit = getComputedStyle(video).objectFit;
  let scaleX = box.width / sourceWidth;
  let scaleY = box.height / sourceHeight;
  let originX = 0;
  let originY = 0;
  if (fit === "cover" || fit === "contain") {
    const scale =
      fit === "cover"
        ? Math.max(box.width / sourceWidth, box.height / sourceHeight)
        : Math.min(box.width / sourceWidth, box.height / sourceHeight);
    scaleX = scale;
    scaleY = scale;
    originX = (box.width - sourceWidth * scale) / 2;
    originY = (box.height - sourceHeight * scale) / 2;
  }

  const sx = (left - box.left - originX) / scaleX;
  const sy = (top - box.top - originY) / scaleY;
  const sw = viewWidth / scaleX;
  const sh = viewHeight / scaleY;
  const x = Math.max(0, Math.min(sourceWidth - 1, sx));
  const y = Math.max(0, Math.min(sourceHeight - 1, sy));
  const w = Math.max(1, Math.min(sourceWidth - x, sw));
  const h = Math.max(1, Math.min(sourceHeight - y, sh));
  return { sx: x, sy: y, sw: w, sh: h };
}

export function frameFromVideo(
  video: HTMLVideoElement,
  crop?: { x: number; y: number; w: number; h: number },
  maxEdge = PHOTO_MAX_EDGE,
  quality = PHOTO_JPEG_QUALITY,
): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error("La caméra n'est pas prête."));
  }
  const region = normalizeCrop(crop);
  const sx = Math.max(0, Math.round(region.x * video.videoWidth));
  const sy = Math.max(0, Math.round(region.y * video.videoHeight));
  const sw = Math.max(1, Math.min(video.videoWidth - sx, Math.round(region.w * video.videoWidth)));
  const sh = Math.max(1, Math.min(video.videoHeight - sy, Math.round(region.h * video.videoHeight)));
  return drawJpeg(sw, sh, (ctx, w, h) => ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h), maxEdge, quality);
}

async function bestVideoFrame(
  video: HTMLVideoElement,
  options: {
    crop: { x: number; y: number; w: number; h: number };
    finder?: HTMLElement | null;
    matchFinder?: boolean;
    mirror: boolean;
  },
): Promise<Blob> {
  const samples: { score: number; blob: Blob }[] = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) await wait(90);
    const blob =
      options.matchFinder && options.finder
        ? await frameMatchingView(video, options.finder)
        : await frameFromVideo(video, options.crop);
    const score = await scoreBlobSharpness(blob);
    samples.push({ score, blob });
  }
  samples.sort((a, b) => b.score - a.score);
  return samples[0]?.blob ?? frameFromVideo(video, options.crop);
}

async function scoreBlobSharpness(blob: Blob): Promise<number> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const w = Math.min(320, bitmap.width);
      const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 0;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      return laplacianVar(data, w, h);
    } finally {
      bitmap.close?.();
    }
  } catch {
    return 0;
  }
}

function laplacianVar(data: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const c = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const up = data[((y - 1) * w + x) * 4] * 0.299 + data[((y - 1) * w + x) * 4 + 1] * 0.587 + data[((y - 1) * w + x) * 4 + 2] * 0.114;
      const dn = data[((y + 1) * w + x) * 4] * 0.299 + data[((y + 1) * w + x) * 4 + 1] * 0.587 + data[((y + 1) * w + x) * 4 + 2] * 0.114;
      const lf = data[(y * w + x - 1) * 4] * 0.299 + data[(y * w + x - 1) * 4 + 1] * 0.587 + data[(y * w + x - 1) * 4 + 2] * 0.114;
      const rt = data[(y * w + x + 1) * 4] * 0.299 + data[(y * w + x + 1) * 4 + 1] * 0.587 + data[(y * w + x + 1) * 4 + 2] * 0.114;
      const lap = Math.abs(4 * c - up - dn - lf - rt);
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeCrop(crop?: { x: number; y: number; w: number; h: number }) {
  if (!crop) return { x: 0, y: 0, w: 1, h: 1 };
  const w = Math.min(1, Math.max(0.05, crop.w));
  const h = Math.min(1, Math.max(0.05, crop.h));
  const x = Math.min(1 - w, Math.max(0, crop.x));
  const y = Math.min(1 - h, Math.max(0, crop.y));
  return { x, y, w, h };
}

function isFullRegion(region: { sx: number; sy: number; sw: number; sh: number }, w: number, h: number) {
  return region.sx <= 2 && region.sy <= 2 && region.sw >= w - 4 && region.sh >= h - 4;
}

function isMirrored(video: HTMLVideoElement) {
  const transform = video.style.transform || getComputedStyle(video).transform;
  return transform.includes("scaleX(-1)") || transform.startsWith("matrix(-1");
}

function trackFromVideo(video: HTMLVideoElement): MediaStreamTrack | null {
  const stream = video.srcObject;
  if (!(stream instanceof MediaStream)) return null;
  return stream.getVideoTracks()[0] ?? null;
}

async function takeStillBlob(track: MediaStreamTrack): Promise<Blob> {
  const Capture = (globalThis as unknown as { ImageCapture?: typeof ImageCapture }).ImageCapture;
  if (!Capture) throw new Error("ImageCapture indisponible");
  const capture = new Capture(track);
  // Demande la plus grande photo possible si l’API l’expose
  try {
    const caps = await capture.getPhotoCapabilities?.();
    const sizes = (caps as { imageWidth?: { max?: number }; imageHeight?: { max?: number } } | undefined) ?? {};
    const width = sizes.imageWidth?.max;
    const height = sizes.imageHeight?.max;
    if (width && height) {
      return await capture.takePhoto({ imageWidth: width, imageHeight: height } as PhotoSettings);
    }
  } catch {
    /* takePhoto sans options */
  }
  return await capture.takePhoto();
}

function resolveRegion(
  video: HTMLVideoElement,
  photoW: number,
  photoH: number,
  options: {
    finder?: HTMLElement | null;
    crop?: { x: number; y: number; w: number; h: number };
    matchFinder?: boolean;
  },
) {
  const scaleX = photoW / Math.max(1, video.videoWidth);
  const scaleY = photoH / Math.max(1, video.videoHeight);

  if (options.matchFinder && options.finder) {
    const src = visibleSource(video, options.finder);
    if (src) {
      return {
        sx: src.sx * scaleX,
        sy: src.sy * scaleY,
        sw: src.sw * scaleX,
        sh: src.sh * scaleY,
      };
    }
  }

  const crop = normalizeCrop(options.crop);
  const sx = Math.max(0, crop.x * photoW);
  const sy = Math.max(0, crop.y * photoH);
  const sw = Math.max(1, Math.min(photoW - sx, crop.w * photoW));
  const sh = Math.max(1, Math.min(photoH - sy, crop.h * photoH));
  return { sx, sy, sw, sh };
}

function renderRegion(
  bitmap: ImageBitmap,
  region: { sx: number; sy: number; sw: number; sh: number },
  mirror: boolean,
) {
  const sx = Math.max(0, Math.round(region.sx));
  const sy = Math.max(0, Math.round(region.sy));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(region.sw)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(region.sh)));
  return drawJpeg(
    sw,
    sh,
    (ctx, width, height) => {
      if (mirror) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    },
    PHOTO_MAX_EDGE,
    PHOTO_JPEG_QUALITY,
  );
}

async function loadBitmap(file: File | Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Cette image n'est pas lisible ici."));
        el.src = url;
      });
      return await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawJpeg(
  sourceWidth: number,
  sourceHeight: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  maxEdge = PHOTO_MAX_EDGE,
  quality = PHOTO_JPEG_QUALITY,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Impossible de préparer la photo."));
  // Pas de flou artificiel si on ne réduit pas
  ctx.imageSmoothingEnabled = scale < 0.999;
  ctx.imageSmoothingQuality = "high";
  draw(ctx, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Impossible de préparer la photo."))),
      "image/jpeg",
      quality,
    );
  });
}
