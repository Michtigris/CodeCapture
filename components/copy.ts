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

async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Copie impossible.");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Copie impossible."))), "image/png");
  });
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function writePngImages(pngs: Blob[]) {
  if (!navigator.clipboard?.write) throw new Error("Ce navigateur ne copie pas les images.");
  if (pngs.length === 1) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngs[0] })]);
    return "copied" as const;
  }
  try {
    await navigator.clipboard.write(pngs.map((blob) => new ClipboardItem({ "image/png": blob })));
    return "copied" as const;
  } catch {
    /* Chrome n'accepte qu'une seule image dans le presse-papiers. */
  }
  for (let index = 0; index < pngs.length; index += 1) {
    downloadBlob(pngs[index], `photo-${index + 1}.png`);
    if (index < pngs.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 180));
  }
  return "downloaded" as const;
}

export async function copyPhotoSet(shots: { id: string; url: string }[]): Promise<{
  ids: string[];
  mode: "copied" | "downloaded";
}> {
  if (!shots.length) throw new Error("Aucune photo à copier.");
  const pngs: Blob[] = [];
  const ids: string[] = [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const res = await fetch(shot.url);
    if (!res.ok) continue;
    const blob = await res.blob();
    const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    pngs.push(await toPngBlob(new Blob([blob], { type })));
    ids.push(shot.id);
  }
  if (!pngs.length) throw new Error("Photos introuvables.");
  const mode = await writePngImages(pngs);
  return { ids, mode };
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
