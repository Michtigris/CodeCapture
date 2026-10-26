export function splitPath(filename: string): { folder: string; name: string } {
  const clean = filename.replace(/\\/g, "/").replace(/^\.?\//, "");
  const index = clean.lastIndexOf("/");
  if (index === -1) return { folder: "", name: clean };
  return { folder: clean.slice(0, index), name: clean.slice(index + 1) };
}

export function folderLabel(folder: string): string {
  return folder || "racine";
}
