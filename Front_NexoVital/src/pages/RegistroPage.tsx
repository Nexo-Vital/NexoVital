import { Ambulance, HeartPulse, type LucideIcon, User, UserPlus, Warehouse } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nvButton } from '@/components/ui/button';
import { useSessionStore } from '@/features/usuarios/session';
import { ApiError, type DatosRegistro, registrarCuenta } from '@/services/apiClient';
import { cuentaFirebaseActual, logoutFirebase } from '@/services/firebase';

type RolElegible = DatosRegistro['rol'];

interface OpcionDeRol {
  rol: RolElegible;
  titulo: string;
  descripcion: string;
  icono: LucideIcon;
}

/**
 * Roles que una persona puede elegir para sí misma (docs/matriz-permisos.md,
 * sección 4). El administrador de plataforma nunca aparece aquí: está
 * precargado. Centro de ayuda y de acopio son una sola opción.
 */
export const OPCIONES_DE_ROL: OpcionDeRol[] = [
  {
    rol: 'CIUDADANO',
    titulo: 'Ciudadano',
    descripcion: 'Pide ambulancias, reporta emergencias y dona insumos.',
    icono: User,
  },
  {
    rol: 'ADMIN_CENTRO_AYUDA',
    titulo: 'Administrador de centro',
    descripcion: 'Crea y administra un centro de ayuda o de acopio.',
    icono: Warehouse,
  },
  {
    rol: 'CONDUCTOR',
    titulo: 'Conductor de ambulancia',
    descripcion: 'Recibe y responde solicitudes. Te pediremos la placa y el modelo.',
    icono: Ambulance,
  },
];

/** Placa colombiana de vehículo: tres letras y tres números. Mismo criterio que el backend. */
const PATRON_PLACA = /^[A-Z]{3}\d{3}$/;

/** "abc-123" y "ABC 123" se escriben como ABC123, igual que los normaliza el backend. */
export function normalizarPlaca(placa: string): string {
  return placa.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Valida lo que el backend también valida, para avisar antes de enviar.
 *
 * @returns el mensaje del primer error, o `null` si los datos están completos
 */
export function validarRegistro(
  rol: RolElegible | null,
  placa: string,
  modelo: string,
): string | null {
  if (!rol) {
    return 'Elige cómo vas a usar NexoVital.';
  }
  if (rol !== 'CONDUCTOR') {
    return null;
  }
  const placaNormalizada = normalizarPlaca(placa);
  if (!placaNormalizada) {
    return 'Escribe la placa del vehículo.';
  }
  if (!PATRON_PLACA.test(placaNormalizada)) {
    return 'La placa debe tener tres letras y tres números, por ejemplo ABC123.';
  }
  if (!modelo.trim()) {
    return 'Escribe el modelo del vehículo.';
  }
  return null;
}

const CAMPO =
  'flex h-[52px] items-center gap-3 rounded-nv-md border-[1.5px] border-nv-line bg-white px-4 focus-within:border-nv-teal focus-within:shadow-[0_0_0_3px_rgb(93_186_168_/_0.22)]';
const ENTRADA =
  'h-full min-w-0 flex-1 border-0 bg-transparent text-base text-nv-navy outline-none placeholder:text-nv-navy-400 disabled:opacity-50';

/**
 * Registro de una cuenta de Google que todavía no tiene usuario (EP-06.F2.US1,
 * T10). Llega aquí desde el login cuando el backend responde
 * `USUARIO_NO_REGISTRADO`. La persona elige su rol y, si es conductor, la placa
 * y el modelo del vehículo. El nombre y el correo los toma el backend del token.
 *
 * <p>No guarda el token: lo pide a Firebase al enviar, para que siga vigente
 * aunque la persona tarde. Sin sesión de Google abierta, vuelve al login.
 */
export default function RegistroPage() {
  const navigate = useNavigate();
  const applyServerSession = useSessionStore((state) => state.applyServerSession);

  const [cuenta, setCuenta] = useState<{ email: string | null; nombre: string | null } | null>(
    null,
  );
  const [rol, setRol] = useState<RolElegible | null>(null);
  const [placa, setPlaca] = useState('');
  const [modelo, setModelo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    void cuentaFirebaseActual().then((actual) => {
      if (!activo) {
        return;
      }
      if (!actual) {
        navigate('/login', { replace: true });
        return;
      }
      setCuenta({ email: actual.email, nombre: actual.nombre });
    });
    return () => {
      activo = false;
    };
  }, [navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (enviando) {
      return;
    }
    const problema = validarRegistro(rol, placa, modelo);
    if (problema || !rol) {
      setError(problema);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const actual = await cuentaFirebaseActual();
      if (!actual) {
        navigate('/login', { replace: true });
        return;
      }
      const datos: DatosRegistro =
        rol === 'CONDUCTOR'
          ? { rol, placa: normalizarPlaca(placa), modelo: modelo.trim() }
          : { rol };
      const usuario = await registrarCuenta(actual.token, datos);
      applyServerSession(actual.token, usuario);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo completar el registro.');
    } finally {
      setEnviando(false);
    }
  };

  const usarOtraCuenta = async () => {
    await logoutFirebase();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-nv-mint p-6">
      <div className="flex w-full max-w-[520px] flex-col gap-6 rounded-nv-lg bg-white p-8 shadow-nv-card sm:p-10">
        <div className="flex items-center gap-3 text-nv-navy">
          <HeartPulse className="size-8 shrink-0 text-nv-teal" aria-hidden />
          <span className="font-bold text-xl tracking-[-0.02em]">NexoVital</span>
        </div>

        <div>
          <h1 className="font-semibold text-2xl text-nv-navy tracking-[-0.3px]">
            Completa tu registro
          </h1>
          <p className="mt-1.5 text-nv-navy-400 text-sm leading-5">
            {cuenta?.email
              ? `Entraste con ${cuenta.email}. Elige cómo vas a usar NexoVital.`
              : 'Elige cómo vas a usar NexoVital.'}
          </p>
        </div>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <fieldset className="flex flex-col gap-3" disabled={enviando}>
            <legend className="mb-2 font-semibold text-nv-navy text-sm">Tu rol</legend>
            {OPCIONES_DE_ROL.map((opcion) => {
              const Icono = opcion.icono;
              const elegido = rol === opcion.rol;
              return (
                <label
                  key={opcion.rol}
                  className={`flex cursor-pointer items-start gap-3 rounded-nv-md border-[1.5px] p-4 transition-colors has-[:focus-visible]:shadow-[0_0_0_3px_rgb(93_186_168_/_0.22)] ${
                    elegido
                      ? 'border-nv-teal bg-nv-mint'
                      : 'border-nv-line bg-white hover:bg-nv-mint'
                  }`}
                >
                  <input
                    type="radio"
                    name="rol"
                    value={opcion.rol}
                    checked={elegido}
                    onChange={() => {
                      setRol(opcion.rol);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  <Icono className="mt-0.5 size-6 shrink-0 text-nv-navy" aria-hidden />
                  <span className="flex flex-col">
                    <span className="font-semibold text-base text-nv-navy">{opcion.titulo}</span>
                    <span className="text-nv-navy-400 text-sm leading-5">{opcion.descripcion}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {rol === 'CONDUCTOR' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col">
                <label htmlFor="registro-placa" className="mb-2 font-semibold text-nv-navy text-sm">
                  Placa del vehículo
                </label>
                <div className={CAMPO}>
                  <input
                    id="registro-placa"
                    name="placa"
                    autoComplete="off"
                    placeholder="ABC123"
                    maxLength={8}
                    value={placa}
                    onChange={(event) => setPlaca(event.target.value.toUpperCase())}
                    disabled={enviando}
                    className={`${ENTRADA} uppercase`}
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label
                  htmlFor="registro-modelo"
                  className="mb-2 font-semibold text-nv-navy text-sm"
                >
                  Modelo del vehículo
                </label>
                <div className={CAMPO}>
                  <input
                    id="registro-modelo"
                    name="modelo"
                    autoComplete="off"
                    placeholder="Ej. Renault Master 2022"
                    maxLength={60}
                    value={modelo}
                    onChange={(event) => setModelo(event.target.value)}
                    disabled={enviando}
                    className={ENTRADA}
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-nv-md border border-nv-red-600/40 bg-nv-red-600/10 px-3 py-2 text-nv-red-600 text-xs"
            >
              {error}
            </p>
          )}

          <button type="submit" disabled={enviando} className={nvButton()}>
            <UserPlus className="size-5 shrink-0" aria-hidden />
            {enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
          </button>
          <button
            type="button"
            onClick={usarOtraCuenta}
            disabled={enviando}
            className={nvButton({ tone: 'secondary' })}
          >
            Usar otra cuenta de Google
          </button>
        </form>
      </div>
    </div>
  );
}
