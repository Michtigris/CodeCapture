import { downloadBlob, zipBlobs } from "./zip";

const PHOTO_ZIP_NAME = "CodeCapture-photos.zip";

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

async function saveZip(blob: Blob) {
  const picker = (window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  }).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: PHOTO_ZIP_NAME,
        types: [
          {
            description: "Archive ZIP",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved" as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      /* Ancien Chrome / refus : téléchargement classique. */
    }
  }
  downloadBlob(PHOTO_ZIP_NAME, blob);
  return "downloaded" as const;
}

export async function copyPhotoSet(shots: { id: string; url: string }[]): Promise<{
  ids: string[];
  mode: "saved" | "downloaded";
}> {
  if (!shots.length) throw new Error("Aucune photo à exporter.");
  const files: { name: string; data: Uint8Array }[] = [];
  const ids: string[] = [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const res = await fetch(shot.url);
    if (!res.ok) continue;
    const blob = await res.blob();
    const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    const data = new Uint8Array(await blob.arrayBuffer());
    const pad = String(index + 1).padStart(2, "0");
    files.push({ name: `photo-${pad}.${imageExt(type)}`, data });
    ids.push(shot.id);
  }
  if (!files.length) throw new Error("Photos introuvables.");
  const mode = await saveZip(zipBlobs(files));
  return { ids, mode };
}

export function downloadText(filename: string, content: string) {
  downloadBlob(filename, new Blob([content], { type: "text/plain;charset=utf-8" }));
}
