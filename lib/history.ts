export const HISTORY_MS = 14 * 24 * 60 * 60 * 1000;
export const FREE_FLOOR = 300 * 1024 * 1024;

export type HistoryPhoto = {
  id: string;
  createdAt: string;
  archivedAt?: string;
  captureId: string | null;
  bytes: number;
};

function stamp(photo: HistoryPhoto): number {
  const time = Date.parse(photo.archivedAt || photo.createdAt);
  return Number.isFinite(time) ? time : 0;
}

export function chooseHistoryDrops(photos: HistoryPhoto[], now: number, free: number | null): string[] {
  const history = photos.filter((photo) => photo.captureId).sort((a, b) => stamp(a) - stamp(b));
  const drop = new Set<string>();
  for (const photo of history) {
    if (now - stamp(photo) >= HISTORY_MS) drop.add(photo.id);
  }
  if (free !== null) {
    let room = free;
    for (const photo of history) {
      if (drop.has(photo.id)) room += photo.bytes;
    }
    for (const photo of history) {
      if (room >= FREE_FLOOR) break;
      if (drop.has(photo.id)) continue;
      drop.add(photo.id);
      room += photo.bytes;
    }
  }
  return [...drop];
}
