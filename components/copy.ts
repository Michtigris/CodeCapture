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

export async function copyPhotoSet(urls: string[]): Promise<void> {
  if (!urls.length) throw new Error("Aucune photo à copier.");
  if (!navigator.clipboard?.write) throw new Error("Ce navigateur ne copie pas les images.");
  const png = (async () => {
    const bitmaps: ImageBitmap[] = [];
    for (const url of urls.slice(0, 8)) {
      const res = await fetch(url);
      if (!res.ok) continue;
      bitmaps.push(await createImageBitmap(await res.blob()));
    }
    if (!bitmaps.length) throw new Error("Photos introuvables.");
    const width = 1100;
    const gap = 18;
    const heights = bitmaps.map((bitmap) => Math.max(1, Math.round(width * (bitmap.height / bitmap.width))));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = heights.reduce((sum, height) => sum + height, 0) + gap * (bitmaps.length - 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Copie impossible.");
    ctx.fillStyle = "#11140f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    bitmaps.forEach((bitmap, index) => {
      ctx.drawImage(bitmap, 0, y, width, heights[index]);
      y += heights[index] + gap;
      bitmap.close();
    });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Copie impossible."))), "image/png");
    });
    return blob;
  })();
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
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
