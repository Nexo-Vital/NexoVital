import {
  Ambulance,
  Eye,
  EyeOff,
  HandHeart,
  HeartPulse,
  Info,
  Lock,
  LogIn,
  User,
  Warehouse,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DemoProfilesPanel } from '@/features/usuarios/DemoProfilesPanel';
import { hasRoleHome, roleWithoutHomeMessage } from '@/features/usuarios/role-home';
import { type DemoUser, useSessionStore } from '@/features/usuarios/session';
import { ApiError } from '@/services/apiClient';

/**
 * Per-character delay of the demo autofill. 20 ms is the fast end of the
 * 20-40 ms range: a whole credential (email + password, ~26 chars) lands in
 * ~0.5 s, so it reads as someone typing very fast instead of a slow script.
 */
const TYPE_DELAY_MS = 20;

/**
 * Brand-panel copy for the citizen persona, transcribed verbatim from the
 * mockup (`C.c1`, `citizenPerks`). This surface is fixed to the mockup palette:
 * the login does not follow the light/dark theme, so it only uses `nv-*` tokens
 * and explicit `#fff`, never semantic tokens (`bg-card`, `text-foreground`).
 */
const CITIZEN_PERKS = [
  { icon: Ambulance, text: 'Ambulancias cercanas, disponibles u ocupadas' },
  { icon: Warehouse, text: 'Centros de acopio con su semáforo de insumos' },
  { icon: HandHeart, text: 'Donaciones que se ven reflejadas al instante' },
] as const;

/**
 * True when the OS asks to reduce motion. Read at click time (instead of
 * subscribing) so the autofill always honors the freshest preference.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Resolves after `ms`; setTimeout keeps the animation drivable with fake timers. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Types `text` one character at a time, awaiting `TYPE_DELAY_MS` after each keystroke. */
async function typeText(text: string, setValue: (value: string) => void): Promise<void> {
  let typed = '';
  for (const character of text) {
    typed += character;
    setValue(typed);
    await sleep(TYPE_DELAY_MS);
  }
}

/**
 * Real sign-in. The credentials travel to POST /api/v1/sesiones and, on success, the
 * token and the session are persisted before redirecting to the role home
 * (RoleHome decides the landing screen from the stored role). A role with no
 * screen in this build is not let in: the session is cleared and the reason is
 * shown on the form. The demo profiles panel shares this exact path: it only
 * fills the form and submits it, so no session is ever granted without the backend.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const login = useSessionStore((state) => state.login);
  const logout = useSessionStore((state) => state.logout);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockRemaining, setLockRemaining] = useState<number | null>(null);

  // Prevents a second profile click from starting a parallel typing run.
  const fillingRef = useRef(false);

  const locked = lockRemaining !== null;
  const disabled = submitting || filling || locked;

  // Live countdown for the account lockout; unlocks the form when it reaches 0.
  useEffect(() => {
    if (lockRemaining === null) {
      return;
    }
    if (lockRemaining <= 0) {
      setLockRemaining(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setLockRemaining((current) => (current === null ? null : current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [lockRemaining]);

  /** Single login path: manual submits and the demo autofill both go through here. */
  const submitCredentials = async (emailValue: string, passwordValue: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const usuario = await login(emailValue.trim(), passwordValue);
      if (!hasRoleHome(usuario.rol)) {
        // The account authenticated, but this build has no screen for this
        // role: drop the session instead of entering a screen that is not its
        // own, and explain why on the form.
        logout();
        setError(roleWithoutHomeMessage(usuario.rol));
        return;
      }
      navigate('/', { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 423 && cause.retryAfter) {
          setLockRemaining(cause.retryAfter);
        }
        setError(cause.message);
      } else {
        setError('No se pudo iniciar sesión');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    await submitCredentials(email, password);
  };

  const handleProfileSelect = async (profile: DemoUser) => {
    if (fillingRef.current || disabled) {
      return;
    }
    fillingRef.current = true;
    setFilling(true);
    setError(null);
    try {
      if (prefersReducedMotion()) {
        setEmail(profile.email);
        setPassword(profile.password);
      } else {
        await typeText(profile.email, setEmail);
        await typeText(profile.password, setPassword);
      }
      await submitCredentials(profile.email, profile.password);
    } finally {
      fillingRef.current = false;
      setFilling(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col bg-nv-mint lg:flex-row">
      {/*
        The demo panel floats above the page instead of sitting in the flow, so
        opening or collapsing it never shifts the sign-in form. It is opaque and
        limited to 62dvh, which keeps it scrollable rather than covering the form.
      */}
      <div className="absolute inset-x-0 top-0 z-20 flex justify-end p-3">
        <DemoProfilesPanel disabled={disabled} busy={filling} onSelect={handleProfileSelect} />
      </div>

      {/*
        Brand panel: navy on the left from `lg`, a compact banner on mobile.
        The long copy and the perks hide below `lg` so the card never gets
        pushed off screen.
      */}
      <section className="flex w-full flex-col justify-center gap-8 bg-nv-navy px-6 py-6 text-white lg:w-1/2 lg:px-20 lg:py-0">
        <div className="flex items-center gap-3">
          <HeartPulse className="size-9 shrink-0 text-nv-lime" aria-hidden />
          <span className="text-2xl font-bold tracking-[-0.02em]">NexoVital</span>
        </div>

        <div className="hidden flex-col gap-8 lg:flex">
          <h2 className="max-w-[9ch] text-balance font-bold text-[32px] leading-10 tracking-[-0.5px]">
            Coordinación logística para emergencias
          </h2>
          <p className="max-w-[46ch] text-base text-nv-sky leading-6">
            Pide una ambulancia y sigue su llegada en el mapa. Mira qué centros de acopio necesitan
            ayuda y dona lo que les falta.
          </p>
          <ul className="flex flex-col gap-4">
            {CITIZEN_PERKS.map((perk) => {
              const PerkIcon = perk.icon;
              return (
                <li
                  key={perk.text}
                  className="flex items-center gap-3 text-nv-sky text-sm leading-5"
                >
                  <PerkIcon className="size-5 shrink-0 text-nv-lime" aria-hidden />
                  {perk.text}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Access panel: white card over mint, fixed to the mockup palette. */}
      <section className="flex flex-1 items-center justify-center bg-nv-mint p-6 lg:w-1/2">
        <div className="flex w-full max-w-[420px] flex-col gap-5 rounded-nv-lg bg-white p-10 shadow-nv-card">
          <div>
            <h3 className="font-semibold text-2xl text-nv-navy tracking-[-0.3px]">Inicia sesión</h3>
            <p className="mt-1.5 text-nv-navy-400 text-sm leading-5">
              Entra con la cuenta que te asignó el equipo de NexoVital
            </p>
          </div>

          <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col">
              <label htmlFor="login-email" className="mb-2 font-semibold text-nv-navy text-sm">
                Usuario o correo
              </label>
              <div className="flex h-[52px] items-center gap-3 rounded-nv-md border-[1.5px] border-nv-line bg-white px-4 focus-within:border-nv-teal focus-within:shadow-[0_0_0_3px_rgb(93_186_168_/_0.22)]">
                <User className="size-5 shrink-0 text-nv-navy-400" aria-hidden />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={disabled}
                  aria-invalid={error !== null}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-nv-navy outline-none placeholder:text-nv-navy-400 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex flex-col">
              <label htmlFor="login-password" className="mb-2 font-semibold text-nv-navy text-sm">
                Contraseña
              </label>
              <div className="flex h-[52px] items-center gap-3 rounded-nv-md border-[1.5px] border-nv-line bg-white px-4 focus-within:border-nv-teal focus-within:shadow-[0_0_0_3px_rgb(93_186_168_/_0.22)]">
                <Lock className="size-5 shrink-0 text-nv-navy-400" aria-hidden />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={disabled}
                  aria-invalid={error !== null}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-nv-navy outline-none placeholder:text-nv-navy-400 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="flex size-5 shrink-0 items-center justify-center text-nv-navy-400 transition-colors hover:text-nv-navy focus-visible:outline-2 focus-visible:outline-nv-teal focus-visible:outline-offset-2"
                >
                  {showPassword ? (
                    <EyeOff className="size-5" aria-hidden />
                  ) : (
                    <Eye className="size-5" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-nv-md border border-nv-red-600/40 bg-nv-red-600/10 px-3 py-2 text-nv-red-600 text-xs"
              >
                {locked
                  ? `Cuenta bloqueada temporalmente. Intente nuevamente en ${lockRemaining} s.`
                  : error}
              </p>
            )}

            <button
              type="submit"
              disabled={disabled}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy font-semibold text-base text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn className="size-5 shrink-0" aria-hidden />
              {submitting ? 'Ingresando…' : 'Iniciar sesión'}
            </button>

            <div className="h-px bg-nv-line" aria-hidden />

            <div className="flex items-start gap-2 rounded-nv-md bg-nv-mint p-2.5 px-3 text-[12.5px] text-nv-navy-400 leading-[18px]">
              <Info className="mt-px size-4 shrink-0 text-nv-navy-600" aria-hidden />
              <span>
                En el MVP no hay registro: las cuentas de ciudadano y de conductor vienen
                precargadas.
              </span>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
