import { findDemoAccount } from '../mocks/demo-users';
import type { Usuario } from '../types/domain';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

/**
 * Demo mode is an explicit BUILD decision, never a runtime fallback: it is on
 * only when the build-time flag `VITE_DEMO_MODE` is exactly the string '1'.
 *
 * It is read inside the session functions (not as a module-level constant) so
 * tests can flip it per case with `vi.stubEnv`. The flag is absent by default,
 * so local dev and every existing test keep hitting the real backend.
 *
 * Exported as the SINGLE source of the flag check: the map data source must make
 * the same decision, never a second, drifting copy of it.
 */
export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === '1';
}

/**
 * The session lives in `sessionStorage`, never `localStorage`.
 *
 * `localStorage` is origin-global: every tab of the origin shares it, so a
 * second tab signing in as another role would overwrite the first tab's
 * `nexovital.token` / `nexovital.session`. That broke the multi-role demo — the
 * first tab would send a foreign token and the backend would answer a
 * misleading 403. `sessionStorage` is scoped per tab, so two roles can stay
 * signed in at the same time; each tab travels with its own token.
 */
export const TOKEN_KEY = 'nexovital.token';
export const SESSION_KEY = 'nexovital.session';

export class ApiError extends Error {
  status: number;
  codigo?: string;
  /** Remaining seconds from a 423 `Retry-After` header, when present. */
  retryAfter?: number;

  constructor(status: number, mensaje: string, codigo?: string, retryAfter?: number) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.retryAfter = retryAfter;
  }
}

/** Parses `Retry-After` as a seconds count; returns null when unparsable. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }
  return null;
}

export interface LoginResponse {
  token: string;
  usuario: Usuario;
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function getSession(): Usuario | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Usuario) : null;
  } catch {
    return null;
  }
}

export function setSession(usuario: Usuario): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(usuario));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function logout(): void {
  clearToken();
  clearSession();
}

/**
 * Resolves the login against the hardcoded catalog with zero network traffic.
 *
 * A match returns the same `LoginResponse` shape as the real endpoint and
 * persists the token + session through the shared helpers, so the stored shape
 * is identical in both paths. A mismatch throws the same 401 `ApiError` the real
 * path ends up throwing against the seeded backend: the controller answers
 * `CREDENCIALES_INVALIDAS` with its own message, and the real path overrides its
 * fallback message with that body, so `LoginPage` renders its existing error UI.
 */
function demoLogin(email: string, password: string): LoginResponse {
  const account = findDemoAccount(email, password);
  if (!account) {
    throw new ApiError(401, 'Credenciales inválidas.', 'CREDENCIALES_INVALIDAS');
  }

  const usuario: Usuario = {
    id: account.id,
    nombre: account.nombre,
    email: account.email,
    rol: account.rol,
  };
  // Synthetic token: nothing validates it, but the real flow persists a token,
  // so demo mode persists one too to keep the stored session shape identical.
  const token = `demo.${account.id}`;
  setToken(token);
  setSession(usuario);
  return { token, usuario };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  if (isDemoMode()) {
    return demoLogin(email, password);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/sesiones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar al servidor');
  }

  if (response.ok) {
    return (await response.json()) as LoginResponse;
  }

  let codigo: string | undefined;
  let mensaje =
    response.status === 401 ? 'Credenciales inválidas' : `Error HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { codigo?: string; mensaje?: string };
    codigo = body.codigo;
    mensaje = body.mensaje ?? mensaje;
  } catch {
    // body vacío o no JSON: usar el mensaje por defecto del status
  }

  if (response.status === 423) {
    throw new ApiError(
      423,
      mensaje,
      codigo,
      parseRetryAfter(response.headers.get('Retry-After')) ?? undefined,
    );
  }

  throw new ApiError(response.status, mensaje, codigo);
}

/**
 * Reads the persisted session back with zero network traffic. With no stored
 * session it throws the same 401 `ApiError` the real endpoint produces, so
 * `guards.tsx` redirects to /login exactly as it does today.
 */
function demoGetMe(): Usuario {
  const usuario = getSession();
  if (!usuario) {
    throw new ApiError(401, 'Sesión expirada o no autenticado');
  }
  return usuario;
}

export async function getMe(token: string): Promise<Usuario> {
  if (isDemoMode()) {
    return demoGetMe();
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/sesiones/actual`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Same defect class as `apiFetch`: a rejected fetch is a native TypeError,
    // and its raw English message must never reach the Spanish UI.
    throw new ApiError(0, 'No se pudo conectar al servidor');
  }

  if (response.status === 401) {
    throw new ApiError(401, 'Sesión expirada o no autenticado');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Error HTTP ${response.status}`);
  }

  return (await response.json()) as Usuario;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    // A rejected fetch (backend down, no network) is a native TypeError, not an
    // ApiError. Wrap it in the same 0-status Spanish ApiError `login` uses, so
    // consumers never surface the browser's raw English message.
    throw new ApiError(0, 'No se pudo conectar al servidor');
  }

  if (response.status === 401) {
    logout();
    window.location.assign('/login');
    throw new ApiError(401, 'Sesión expirada o no autenticado');
  }

  if (!response.ok) {
    let codigo: string | undefined;
    let mensaje = `Error HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { codigo?: string; mensaje?: string };
      codigo = body.codigo;
      mensaje = body.mensaje ?? mensaje;
    } catch {
      // body vacío o no JSON: usar mensaje genérico
    }
    throw new ApiError(response.status, mensaje, codigo);
  }

  return response.json() as Promise<T>;
}
