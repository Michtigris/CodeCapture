export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Copie impossible."))), "image/png");
  });
}

async function stackPhotos(bitmaps: ImageBitmap[]): Promise<Blob> {
  const maxSide = 16384;
  const gap = 18;
  const nativeWidth = bitmaps.reduce((max, bitmap) => Math.max(max, bitmap.width), 1);
  const nativeHeight = bitmaps.reduce((sum, bitmap) => sum + bitmap.height, 0) + gap * Math.max(0, bitmaps.length - 1);
  const scale = Math.min(1, maxSide / nativeWidth, maxSide / nativeHeight);
  const sizes = bitmaps.map((bitmap) => ({
    w: Math.max(1, Math.round(bitmap.width * scale)),
    h: Math.max(1, Math.round(bitmap.height * scale)),
  }));
  const gapPx = Math.round(gap * scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(nativeWidth * scale));
  canvas.height = sizes.reduce((sum, size) => sum + size.h, 0) + gapPx * Math.max(0, sizes.length - 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Copie impossible.");
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#11140f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (let index = 0; index < bitmaps.length; index += 1) {
    ctx.drawImage(bitmaps[index], 0, y, sizes[index].w, sizes[index].h);
    y += sizes[index].h + gapPx;
    bitmaps[index].close();
  }
  return canvasToPng(canvas);
}

export async function copyPhotoSet(shots: { id: string; url: string }[]): Promise<string[]> {
  if (!shots.length) throw new Error("Aucune photo à copier.");
  if (!navigator.clipboard?.write) throw new Error("Ce navigateur ne copie pas les images.");
  const bitmaps: ImageBitmap[] = [];
  const copied: string[] = [];
  for (const shot of shots) {
    const res = await fetch(shot.url);
    if (!res.ok) continue;
    bitmaps.push(await createImageBitmap(await res.blob()));
    copied.push(shot.id);
  }
  if (!bitmaps.length) throw new Error("Photos introuvables.");

  let png: Blob;
  if (bitmaps.length === 1) {
    const canvas = document.createElement("canvas");
    canvas.width = bitmaps[0].width;
    canvas.height = bitmaps[0].height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Copie impossible.");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmaps[0], 0, 0);
    bitmaps[0].close();
    png = await canvasToPng(canvas);
  } else {
    png = await stackPhotos(bitmaps);
  }

  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  return copied;
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
