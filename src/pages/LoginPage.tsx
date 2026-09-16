import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DEV_ROLES, useSessionStore } from '@/features/usuarios/session';
import type { RolUsuario } from '@/types/domain';

const ROLE_LABEL: Record<RolUsuario, string> = {
  ADMIN_CENTRO_AYUDA: 'Help Center Admin (CRUE coordinator)',
  CONDUCTOR: 'Ambulance Driver',
  ADMIN_ACOPIO: 'Supply Center Admin',
  ADMIN_PLATAFORMA: 'Platform Admin',
  CIUDADANO: 'Citizen',
};

/**
 * Development sign-in. Authentication is mocked: picking a role fabricates the
 * session. The real flow will call POST /auth/login and store the JWT.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const login = useSessionStore((state) => state.login);

  const handleEnter = (role: RolUsuario) => {
    login(role);
    navigate('/', { replace: true });
  };

  return (
    <div className="grid h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Nexo Vital</CardTitle>
          <CardDescription>CRUE operations room - development sign-in</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Pick a role to enter. Authentication is mocked in this unit; no backend is called.
          </p>
          <div className="flex flex-col gap-2">
            {DEV_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => handleEnter(role)}
                className={
                  role === 'ADMIN_CENTRO_AYUDA'
                    ? 'rounded-md bg-primary px-3 py-2 text-left text-primary-foreground text-sm transition-colors hover:bg-primary/90'
                    : 'rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground'
                }
              >
                <span className="block font-medium">{ROLE_LABEL[role]}</span>
                <span className="tabular block text-[11px] opacity-70">{role}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
