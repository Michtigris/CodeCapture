export async function fileToJpeg(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  try {
    return await drawJpeg(bitmap.width, bitmap.height, (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h));
  } finally {
    bitmap.close?.();
  }
}

export function frameFromVideo(
  video: HTMLVideoElement,
  crop?: { x: number; y: number; w: number; h: number },
  maxEdge = 1800,
  quality = 0.86,
): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error("La caméra n'est pas prête."));
  }
  const region = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.max(0, Math.round(region.x * video.videoWidth));
  const sy = Math.max(0, Math.round(region.y * video.videoHeight));
  const sw = Math.max(1, Math.min(video.videoWidth - sx, Math.round(region.w * video.videoWidth)));
  const sh = Math.max(1, Math.min(video.videoHeight - sy, Math.round(region.h * video.videoHeight)));
  return drawJpeg(sw, sh, (ctx, w, h) => ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h), maxEdge, quality);
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
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
  maxEdge = 1600,
  quality = 0.82,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Impossible de préparer la photo."));
  ctx.imageSmoothingEnabled = true;
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

