export const INSERT_MARK = "/:/:";
export const INSERT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const INSERT_DAY_MS = 24 * 60 * 60 * 1000;

export function cleanInsertName(name: string): string | null {
  const filename = name.trim().replace(/\\/g, "/").replace(/\.\./g, "").replace(/^\/+/, "");
  if (!filename || filename.length > 180 || /[\r\n]/.test(filename)) return null;
  return filename;
}

export function parseInsert(raw: string): { filename: string; content: string }[] | null {
  let text = raw.replace(/^\uFEFF/, "").trim();
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf(INSERT_MARK);
  if (start === -1) return null;
  const parts = text.slice(start + INSERT_MARK.length).split(INSERT_MARK);
  if (parts.length < 2 || parts.length % 2 !== 0) return null;
  const files: { filename: string; content: string }[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const filename = cleanInsertName(parts[index] ?? "");
    if (!filename) return null;
    let content = parts[index + 1] ?? "";
    if (content.startsWith("\r\n")) content = content.slice(2);
    else if (content.startsWith("\n")) content = content.slice(1);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    else if (content.endsWith("\n")) content = content.slice(0, -1);
    files.push({ filename, content });
  }
  return files;
}

export function fileStamp(updatedAt: string | undefined, createdAt: string): number {
  const time = Date.parse(updatedAt || createdAt);
  return Number.isFinite(time) ? time : 0;
}
