import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle, type ThemeToggleLabels } from '@/features/tema/ThemeToggle';
import { useThemeStore } from '@/features/tema/theme-store';
import { DemoProfilesPanel } from '@/features/usuarios/DemoProfilesPanel';
import { hasRoleHome, roleWithoutHomeMessage } from '@/features/usuarios/role-home';
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
 * Brand mark per theme. These are two different artworks, not variants of one.
 * Measured from the alpha bounding box: the light file's ink fills 98% of its
 * canvas height while the dark one fills only 84%, and by ink mass the dark would
 * need ~1.14x the box height just to break even. That measurement alone still
 * reads smaller on screen — a dark artwork on a dark surface loses its faint
 * edges — so the dark box deliberately overshoots the measured factor (1.25x) and
 * both sit above the minimum. Each entry declares its own intrinsic size to keep
 * the aspect-ratio hint honest, and only the variant of the active theme is ever
 * requested, which matters: the two files weigh 1.3 MB and 795 KB.
 */
const LOGO = {
  light: { src: '/logo.png', width: 1316, height: 1195, className: 'h-48 sm:h-64' },
  dark: { src: '/logo-dark.png', width: 1254, height: 1254, className: 'h-60 sm:h-80' },
} as const;

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
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const logo = LOGO[resolvedTheme];

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
    <div className="relative flex min-h-dvh flex-col bg-background">
      {/*
        The demo panel floats above the page instead of sitting in the flow, so
        opening or collapsing it never shifts the sign-in form. It is opaque and
        limited to 62dvh, which keeps it scrollable rather than covering the form.
      */}
      <div className="absolute inset-x-0 top-0 z-20 flex justify-end p-3">
        <DemoProfilesPanel
          disabled={disabled}
          busy={filling}
          headerAction={<ThemeToggle labels={THEME_LABELS} />}
          onSelect={handleProfileSelect}
        />
      </div>

      <div className="grid flex-1 place-items-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center">
          {/*
            The brand mark belongs to the page background, not to the sign-in
            card: it sits above the card, on the page's own layer. Decorative on
            purpose, since the heading right below names the screen.
          */}
          <img
            src={logo.src}
            alt=""
            width={logo.width}
            height={logo.height}
            className={`mb-6 max-h-[36vh] w-auto ${logo.className}`}
          />
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-lg">Iniciar sesión</CardTitle>
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
    </div>
  );
}
