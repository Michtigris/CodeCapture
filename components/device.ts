export function deviceId(): string {
  const key = "cc_device";
  const existing = localStorage.getItem(key);
  if (existing && /^[0-9a-f-]{16,80}$/i.test(existing)) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}
