import { placeName } from "./paths";

export const INSERT_MARK = "/:/:";
export const INSERT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const INSERT_DAY_MS = 24 * 60 * 60 * 1000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function stripLineEscapes(value: string): string {
  const lines = value.split("\n");
  if (lines.length < 3) return value;
  const escaped = lines.filter((line) => /\\[ \t]*$/.test(line)).length;
  if (escaped / lines.length < 0.5) return value;
  return lines
    .map((line) => line.replace(/\\[ \t]*$/, "").replace(/\\(?=[<>])/g, ""))
    .join("\n");
}

export function decodeCodeEntities(value: string): string {
  let current = value;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = current.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, body: string) => {
      if (body.charCodeAt(0) !== 35) return NAMED_ENTITIES[body] ?? all;
      const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return all;
      return String.fromCodePoint(code);
    });
    if (next === current) return current;
    current = next;
  }
  return current;
}

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
    const cleaned = cleanInsertName(parts[index] ?? "");
    const filename = cleaned ? placeName(cleaned) : null;
    if (!filename) return null;
    let content = parts[index + 1] ?? "";
    if (content.startsWith("\r\n")) content = content.slice(2);
    else if (content.startsWith("\n")) content = content.slice(1);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    else if (content.endsWith("\n")) content = content.slice(0, -1);
    files.push({ filename, content: stripLineEscapes(decodeCodeEntities(content)) });
  }
  return files;
}

export function fileStamp(updatedAt: string | undefined, createdAt: string): number {
  const time = Date.parse(updatedAt || createdAt);
  return Number.isFinite(time) ? time : 0;
}
