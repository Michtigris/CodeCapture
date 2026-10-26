const KEY = "cc_keep";

export function keepSession(token: string) {
  try {
    if (!/^[0-9a-f]{64}$/i.test(token)) return;
    localStorage.setItem(KEY, token);
  } catch {
    /* navigation privée */
  }
}

export function keptSession(): string {
  try {
    const token = localStorage.getItem(KEY) ?? "";
    return /^[0-9a-f]{64}$/i.test(token) ? token : "";
  } catch {
    return "";
  }
}

export function dropSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* navigation privée */
  }
}
