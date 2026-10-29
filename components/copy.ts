import { downloadBlob, zipBlobs } from "./zip";

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

function imageExt(type: string) {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
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
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Copie impossible."))), "image/png");
  });
}

async function copyOneImage(blob: Blob) {
  if (!navigator.clipboard?.write) throw new Error("Ce navigateur ne copie pas les images.");
  const type = blob.type === "image/png" || blob.type === "image/jpeg" ? blob.type : "image/jpeg";
  try {
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return;
  } catch {
    /* Chrome accepte surtout image/png. */
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": await toPngBlob(blob) })]);
}

export async function copyPhotoSet(shots: { id: string; url: string }[]): Promise<{
  ids: string[];
  mode: "copied" | "zipped";
}> {
  if (!shots.length) throw new Error("Aucune photo à copier.");
  const files: { name: string; data: Uint8Array; blob: Blob }[] = [];
  const ids: string[] = [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const res = await fetch(shot.url);
    if (!res.ok) continue;
    const blob = await res.blob();
    const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    const data = new Uint8Array(await blob.arrayBuffer());
    const pad = String(index + 1).padStart(2, "0");
    files.push({
      name: `photo-${pad}.${imageExt(type)}`,
      data,
      blob: new Blob([data], { type }),
    });
    ids.push(shot.id);
  }
  if (!files.length) throw new Error("Photos introuvables.");
  if (files.length === 1) {
    await copyOneImage(files[0].blob);
    return { ids, mode: "copied" };
  }
  downloadBlob(
    "codecapture-photos.zip",
    zipBlobs(files.map((file) => ({ name: file.name, data: file.data }))),
  );
  return { ids, mode: "zipped" };
}

export function downloadText(filename: string, content: string) {
  downloadBlob(filename, new Blob([content], { type: "text/plain;charset=utf-8" }));
}
