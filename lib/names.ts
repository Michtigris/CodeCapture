export function sameName(left: string, right: string): boolean {
  const clean = (value: string) => value.trim().replace(/\s+/g, " ");
  const a = clean(left);
  const b = clean(right);
  return a.length > 0 && a === b;
}
