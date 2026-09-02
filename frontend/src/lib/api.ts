const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://127.0.0.1:8000/api";

const TOKEN_KEY = "cotg.access";
const REFRESH_KEY = "cotg.refresh";
const SESSION_KEY = "cotg.session";

export type AuthUser = {
  userId: string | null;
  role: string;
  identifier: string;
  name: string;
  email: string;
  position?: string;
};

export type Session = {
  userId: string;
  role: string;
  identifier: string;
  name?: string;
  email?: string;
  position?: string;
};

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function isAdminSession(session: Session | null = getSession()): boolean {
  return session?.role === "admin";
}

export function isDisplaySession(session: Session | null = getSession()): boolean {
  return session?.role === "display";
}

export function homePathForSession(session: Session | null = getSession()): string {
  if (isDisplaySession(session)) return "/tv/scoreboard";
  return "/admin/dashboard";
}

export function canOpenScoreboard(session: Session | null = getSession()): boolean {
  return isAdminSession(session) || isDisplaySession(session);
}

export function setAuth(access: string, refresh: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  const session: Session = {
    userId: user.userId || "",
    role: user.role,
    identifier: user.identifier,
    name: user.name,
    email: user.email,
    position: user.position || "",
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("cotg-storage"));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent("cotg-storage"));
}

async function refreshAccess(): Promise<string | null> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return null;
  const res = await fetch(`${API_BASE}/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearAuth();
    return null;
  }
  const data = (await res.json()) as { access: string };
  localStorage.setItem(TOKEN_KEY, data.access);
  return data.access;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(
      typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : `HTTP ${status}`,
    );
    this.status = status;
    this.body = body;
  }
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  formData?: FormData;
};

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, formData } = opts;
  const auth = opts.auth ?? true;
  const headers: Record<string, string> = {};
  if (!formData) headers["Content-Type"] = "application/json";

  let token = getAccessToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const doFetch = () =>
    fetch(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`, {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

  let res = await doFetch();
  if (res.status === 401 && auth) {
    token = await refreshAccess();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      res = await doFetch();
    } else if (!getAccessToken()) {
      // Session cleared — let caller handle; still throw
    }
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export async function loginPassword(username: string, password: string) {
  const data = await api<{ access: string; refresh: string; user: AuthUser }>(
    "/auth/login/",
    { method: "POST", body: { username, password }, auth: false },
  );
  setAuth(data.access, data.refresh, data.user);
  return data;
}

export async function setPassword(email: string, password: string, passwordConfirm: string) {
  const data = await api<{ access: string; refresh: string; user: AuthUser }>(
    "/auth/set-password/",
    {
      method: "POST",
      body: { email, password, password_confirm: passwordConfirm },
      auth: false,
    },
  );
  setAuth(data.access, data.refresh, data.user);
  return data;
}

export async function requestOtp(phone: string) {
  return api<{ detail: string }>("/auth/request-otp/", {
    method: "POST",
    body: { phone },
    auth: false,
  });
}

export async function verifyOtp(phone: string, otp: string) {
  const data = await api<{ access: string; refresh: string; user: AuthUser }>(
    "/auth/verify-otp/",
    { method: "POST", body: { phone, otp }, auth: false },
  );
  setAuth(data.access, data.refresh, data.user);
  return data;
}

export async function loginByEmail(email: string) {
  const data = await api<{ access: string; refresh: string; user: AuthUser }>(
    "/auth/ghl-email-login/",
    { method: "POST", body: { email }, auth: false },
  );
  setAuth(data.access, data.refresh, data.user);
  return data;
}

export { API_BASE };
