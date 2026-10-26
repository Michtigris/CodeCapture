export function deviceId(): string {
  const key = "cc_device";
  const existing = localStorage.getItem(key);
  if (existing && /^[0-9a-f-]{16,80}$/i.test(existing)) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

export type PcCamera = { id: string; label: string };

const PC_CAMERAS = "cc_pc_cameras";
const PC_CHOICE = "cc_camera_choice";

export function readPcCameras(): PcCamera[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PC_CAMERAS) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const id = "id" in item && typeof item.id === "string" ? item.id : "";
      const label = "label" in item && typeof item.label === "string" ? item.label.trim().slice(0, 80) : "";
      if (id.length < 2 || id.length > 300 || !label) return [];
      return [{ id, label }];
    });
  } catch {
    return [];
  }
}

export function writePcCameras(list: PcCamera[]) {
  localStorage.setItem(PC_CAMERAS, JSON.stringify(list));
}

export function readCameraChoice(): string {
  return localStorage.getItem(PC_CHOICE) || "";
}

export function writeCameraChoice(id: string) {
  if (id) localStorage.setItem(PC_CHOICE, id);
  else localStorage.removeItem(PC_CHOICE);
}
