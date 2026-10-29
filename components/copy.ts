import { downloadBlob } from "./zip";

const PHOTO_PDF_NAME = "CodeCapture-photos.pdf";

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

async function savePdf(blob: Blob) {
  const picker = (window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: PHOTO_PDF_NAME,
        types: [
          {
            description: "PDF",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved" as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }
  downloadBlob(PHOTO_PDF_NAME, blob);
  return "downloaded" as const;
}

export async function exportPhotoPdf(groupId: string): Promise<{
  ids: string[];
  mode: "saved" | "downloaded";
}> {
  const res = await fetch(`/api/groups/${groupId}/packet`);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "PDF impossible.");
  }
  const ids = (res.headers.get("X-Photo-Ids") || "").split(",").filter(Boolean);
  const blob = await res.blob();
  const mode = await savePdf(blob);
  return { ids, mode };
}

export function downloadText(filename: string, content: string) {
  downloadBlob(filename, new Blob([content], { type: "text/plain;charset=utf-8" }));
}
