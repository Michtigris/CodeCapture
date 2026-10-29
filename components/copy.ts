import { downloadBlob } from "./zip";

const PHOTO_PDF_NAME = "-CodeCapture- Photo.pdf";
const HANDLE_DB = "codecapture-files";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "photo-pdf";

type PdfFileHandle = {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  queryPermission?: (desc: { mode: "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  requestPermission?: (desc: { mode: "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
};

let cachedHandle: PdfFileHandle | null = null;

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

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB"));
  });
}

async function loadSavedHandle(): Promise<PdfFileHandle | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readonly");
      const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as PdfFileHandle | undefined) || null);
      req.onerror = () => reject(req.error || new Error("Lecture handle"));
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function persistHandle(handle: PdfFileHandle) {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error || new Error("Écriture handle"));
    });
  } catch {
    // Le cache mémoire suffit pour la session.
  }
}

async function writeToHandle(handle: PdfFileHandle, blob: Blob) {
  if (typeof handle.queryPermission === "function") {
    let status = await handle.queryPermission({ mode: "readwrite" });
    if (status !== "granted" && typeof handle.requestPermission === "function") {
      status = await handle.requestPermission({ mode: "readwrite" });
    }
    if (status !== "granted") return false;
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

async function savePdf(blob: Blob): Promise<"saved" | "updated" | "downloaded"> {
  if (!cachedHandle) cachedHandle = await loadSavedHandle();

  if (cachedHandle) {
    try {
      if (await writeToHandle(cachedHandle, blob)) return "updated";
    } catch {
      cachedHandle = null;
    }
  }

  const picker = (window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<PdfFileHandle>;
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
      await writeToHandle(handle, blob);
      cachedHandle = handle;
      void persistHandle(handle);
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }

  downloadBlob(PHOTO_PDF_NAME, blob);
  return "downloaded";
}

export async function exportPhotoPdf(groupId: string): Promise<{
  ids: string[];
  mode: "saved" | "updated" | "downloaded";
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
