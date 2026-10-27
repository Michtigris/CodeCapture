export function splitPath(filename: string): { folder: string; name: string } {
  const clean = filename.replace(/\\/g, "/").replace(/^\.?\//, "");
  const index = clean.lastIndexOf("/");
  if (index === -1) return { folder: "", name: clean };
  return { folder: clean.slice(0, index), name: clean.slice(index + 1) };
}

export function normalizeFolder(folder: string): string {
  const clean = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean.toLowerCase() === "divers") return "DIVERS";
  return clean;
}

export function folderLabel(folder: string): string {
  return normalizeFolder(folder);
}

export function placeName(filename: string): string {
  const { folder, name } = splitPath(filename);
  return `${normalizeFolder(folder)}/${name}`;
}

export function samePlace(stored: string, incoming: string): boolean {
  const left = splitPath(stored);
  const right = splitPath(incoming);
  return left.name === right.name && normalizeFolder(left.folder) === normalizeFolder(right.folder);
}
