import type { Usuario } from '../types/domain';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

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
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getSession(): Usuario | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Usuario) : null;
  } catch {
    return null;
  }
}

export function setSession(usuario: Usuario): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(usuario));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function logout(): void {
  clearToken();
  clearSession();
}

export async function login(email: string, password: string): Promise<LoginResponse> {
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

export async function getMe(token: string): Promise<Usuario> {
  const response = await fetch(`${API_BASE}/sesiones/actual`, {
    headers: { Authorization: `Bearer ${token}` },
  });

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

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

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
