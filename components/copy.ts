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

async function writeSeparatePhotos(files: File[]) {
  if (files.length === 1 && navigator.clipboard?.write) {
    try {
      const file = files[0];
      const type = file.type === "image/png" || file.type === "image/jpeg" ? file.type : "image/png";
      await navigator.clipboard.write([new ClipboardItem({ [type]: file })]);
      return;
    } catch {
      /* Le format n'est pas accepté : on copie le fichier tel quel. */
    }
  }
  await new Promise<void>((resolve, reject) => {
    const onCopy = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) {
        reject(new Error("Copie impossible."));
        return;
      }
      event.preventDefault();
      let added = 0;
      for (const file of files) {
        if (data.items.add(file)) added += 1;
      }
      if (added !== files.length) {
        reject(new Error("Copie impossible."));
        return;
      }
      resolve();
    };
    document.addEventListener("copy", onCopy, { once: true });
    const ok = document.execCommand("copy");
    if (!ok) {
      document.removeEventListener("copy", onCopy);
      reject(new Error("Ce navigateur ne copie pas plusieurs images."));
    }
  });
}

export async function copyPhotoSet(shots: { id: string; url: string }[]): Promise<string[]> {
  if (!shots.length) throw new Error("Aucune photo à copier.");
  const files: File[] = [];
  const copied: string[] = [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const res = await fetch(shot.url);
    if (!res.ok) continue;
    const blob = await res.blob();
    const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    files.push(new File([blob], `photo-${index + 1}.${imageExt(type)}`, { type }));
    copied.push(shot.id);
  }
  if (!files.length) throw new Error("Photos introuvables.");
  await writeSeparatePhotos(files);
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
