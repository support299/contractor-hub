const EMAIL_PARAM_KEYS = new Set(["email", "useremail", "user_email"]);

function envFlagOn(raw: unknown, defaultOn = true): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === "") return defaultOn;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

export function isGhlEmailLoginEnabled(): boolean {
  return envFlagOn(import.meta.env.VITE_GHL_EMAIL_LOGIN, true);
}

/** Parse email from query string. Keeps `+` in addresses (URLSearchParams would turn it into a space). */
export function emailFromSearch(search: string): string {
  const q = search.startsWith("?") ? search.slice(1) : search;
  if (!q) return "";
  for (const part of q.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    let key = part.slice(0, eq);
    try {
      key = decodeURIComponent(key);
    } catch {
      /* keep raw */
    }
    if (!EMAIL_PARAM_KEYS.has(key.toLowerCase())) continue;
    const raw = part.slice(eq + 1);
    let value = raw.replace(/\+/g, "%2B");
    try {
      value = decodeURIComponent(value);
    } catch {
      value = raw;
    }
    const email = value.trim();
    if (email.includes("@")) return email;
  }
  return "";
}

export function stripEmailParams(search: string): string {
  const q = search.startsWith("?") ? search.slice(1) : search;
  if (!q) return "";
  const kept: string[] = [];
  for (const part of q.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      /* keep raw */
    }
    if (EMAIL_PARAM_KEYS.has(key.toLowerCase())) continue;
    kept.push(part);
  }
  return kept.length ? `?${kept.join("&")}` : "";
}
