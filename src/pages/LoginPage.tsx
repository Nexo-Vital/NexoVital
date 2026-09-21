import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle, type ThemeToggleLabels } from '@/features/tema/ThemeToggle';
import { DemoProfilesPanel } from '@/features/usuarios/DemoProfilesPanel';
import { type DemoUser, useSessionStore } from '@/features/usuarios/session';
import { ApiError } from '@/services/apiClient';

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/**
 * Per-character delay of the demo autofill. 20 ms is the fast end of the
 * 20-40 ms range: a whole credential (email + password, ~26 chars) lands in
 * ~0.5 s, so it reads as someone typing very fast instead of a slow script.
 */
const TYPE_DELAY_MS = 20;

/** Spanish copy for the shared theme toggle: the login page is in Spanish. */
const THEME_LABELS: ThemeToggleLabels = {
  aria: (theme, nextTheme) => `Tema: ${theme}. Cambiar a ${nextTheme}.`,
  tooltip: (theme, nextTheme) => `Tema ${theme} — cambiar a ${nextTheme}`,
};

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
 * Real sign-in. The credentials travel to POST /auth/login and, on success, the
 * token and the session are persisted before redirecting to the role home
 * (RoleHome decides the landing screen from the stored role). The demo profiles
 * panel shares this exact path: it only fills the form and submits it, so no
 * session is ever granted without the backend.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const login = useSessionStore((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      await login(emailValue.trim(), passwordValue);
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
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex justify-end p-3">
        <DemoProfilesPanel
          disabled={disabled}
          busy={filling}
          headerAction={<ThemeToggle labels={THEME_LABELS} />}
          onSelect={handleProfileSelect}
        />
      </div>

      <div className="grid flex-1 place-items-center p-6 pt-0">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-lg">Nexo Vital</CardTitle>
            <CardDescription>Acceso a la sala de operaciones CRUE</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col gap-1">
                <label htmlFor="login-email" className="nv-label text-muted-foreground">
                  Correo electrónico
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={disabled}
                  aria-invalid={error !== null}
                  className={FIELD_CLASS}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="login-password" className="nv-label text-muted-foreground">
                  Contraseña
                </label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={disabled}
                  aria-invalid={error !== null}
                  className={FIELD_CLASS}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs"
                >
                  {locked
                    ? `Cuenta bloqueada temporalmente. Intente nuevamente en ${lockRemaining} s.`
                    : error}
                </p>
              )}

              <Button type="submit" disabled={disabled} className="w-full">
                {submitting ? 'Ingresando…' : 'Ingresar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
