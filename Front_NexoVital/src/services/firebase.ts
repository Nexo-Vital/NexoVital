import type { Auth } from 'firebase/auth';

/**
 * Integración con el IdP externo (Firebase Auth, ADR-0008).
 *
 * <p>La configuración llega por variables de entorno de Vite, que se fijan en
 * tiempo de build. Si no están, el módulo queda inerte y el front sigue usando
 * el login local: así los tests y el desarrollo sin Firebase no dependen de la
 * nube.
 *
 * <p>El SDK se carga con `import()` dinámico y no en la cabecera. Dos motivos:
 * el bundle inicial no paga ~100 KB de Firebase en cada carga, y los tests —que
 * nunca configuran Firebase— no lo importan nunca.
 *
 * <p>`apiKey` de Firebase es un identificador público del proyecto, no un
 * secreto: está diseñado para viajar en el bundle del navegador. Lo que nunca
 * viaja acá es una clave privada ni un service account.
 */
const configuracion = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
};

/** `true` solo si el build trajo la configuración de Firebase. */
export function isFirebaseConfigured(): boolean {
  return Boolean(configuracion.apiKey && configuracion.authDomain && configuracion.projectId);
}

let authPromise: Promise<Auth> | null = null;

/**
 * Inicializa Firebase una sola vez y fija la persistencia **por pestaña**.
 *
 * <p>`browserSessionPersistence` y no la de por defecto: la demo abre varias
 * pestañas con roles distintos, y con persistencia local todas compartirían la
 * misma sesión de Firebase. Es el mismo defecto que ya se corrigió usando
 * `sessionStorage` para el token.
 */
function getFirebaseAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = (async () => {
      const [{ initializeApp }, authMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      const app = initializeApp({
        apiKey: configuracion.apiKey,
        authDomain: configuracion.authDomain,
        projectId: configuracion.projectId,
      });
      const auth = authMod.getAuth(app);
      await authMod.setPersistence(auth, authMod.browserSessionPersistence);
      return auth;
    })();
  }
  return authPromise;
}

/** Autentica contra Firebase y devuelve el ID token. */
export async function loginFirebase(email: string, password: string): Promise<string> {
  const [auth, { signInWithEmailAndPassword }] = await Promise.all([
    getFirebaseAuth(),
    import('firebase/auth'),
  ]);
  const credencial = await signInWithEmailAndPassword(auth, email, password);
  return credencial.user.getIdToken();
}

/**
 * Inicia sesión con Google en una ventana emergente (EP-06.F2.US1, T10) y
 * devuelve el ID token de Firebase. `select_account` hace que Google siempre
 * pregunte con qué cuenta entrar: en la demo se alternan varias cuentas en el
 * mismo navegador.
 */
export async function loginGoogleFirebase(): Promise<string> {
  const [auth, { GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    getFirebaseAuth(),
    import('firebase/auth'),
  ]);
  const proveedor = new GoogleAuthProvider();
  proveedor.setCustomParameters({ prompt: 'select_account' });
  const credencial = await signInWithPopup(auth, proveedor);
  return credencial.user.getIdToken();
}

/** Cuenta de Google con la que hay sesión abierta en Firebase, si la hay. */
export interface CuentaFirebase {
  token: string;
  email: string | null;
  nombre: string | null;
}

/**
 * Token y datos visibles de la cuenta con sesión en Firebase. La pantalla de
 * registro lo usa para pedir un token vigente en vez de guardarlo: un ID token
 * dura una hora y quien se registra puede tardar.
 *
 * @returns `null` si no hay sesión de Firebase abierta en esta pestaña
 */
export async function cuentaFirebaseActual(): Promise<CuentaFirebase | null> {
  if (!isFirebaseConfigured()) {
    return null;
  }
  const auth = await getFirebaseAuth();
  await auth.authStateReady();
  const usuario = auth.currentUser;
  if (!usuario) {
    return null;
  }
  return {
    token: await usuario.getIdToken(),
    email: usuario.email,
    nombre: usuario.displayName,
  };
}

/**
 * Define la contraseña de la cuenta con sesión abierta (registro, T10). La
 * contraseña queda en Firebase, enlazada a la misma cuenta de Google: después
 * se entra con correo y contraseña o con Google, y en los dos casos es el mismo
 * usuario (mismo uid). NexoVital nunca la ve ni la guarda.
 *
 * <p>Si la cuenta ya tenía contraseña (un registro anterior que falló después
 * de este paso), la reemplaza en vez de fallar.
 */
export async function establecerContrasenaFirebase(contrasena: string): Promise<void> {
  const [auth, { EmailAuthProvider, linkWithCredential, updatePassword }] = await Promise.all([
    getFirebaseAuth(),
    import('firebase/auth'),
  ]);
  const usuario = auth.currentUser;
  if (!usuario?.email) {
    throw Object.assign(new Error('No hay sesión de Google abierta'), {
      code: 'auth/no-current-user',
    });
  }
  const yaTieneContrasena = usuario.providerData.some(
    (proveedor) => proveedor.providerId === 'password',
  );
  if (yaTieneContrasena) {
    await updatePassword(usuario, contrasena);
    return;
  }
  await linkWithCredential(usuario, EmailAuthProvider.credential(usuario.email, contrasena));
}

/** Cierra la sesión del IdP. Sin sesión de Firebase abierta no hace nada. */
export async function logoutFirebase(): Promise<void> {
  if (!authPromise) {
    return;
  }
  const [auth, { signOut }] = await Promise.all([authPromise, import('firebase/auth')]);
  await signOut(auth);
}

/**
 * Refresca el token cuando Firebase lo renueva.
 *
 * <p>Un ID token dura una hora. Sin esto, la demo que se extiende empieza a
 * recibir 401 sin que nadie haya cerrado sesión.
 *
 * @returns función para dejar de escuchar
 */
export function observarRefrescoDeToken(alCambiar: (token: string | null) => void): () => void {
  if (!isFirebaseConfigured()) {
    return () => {};
  }
  let cancelado = false;
  let dejarDeEscuchar: (() => void) | undefined;

  void (async () => {
    const [auth, { onIdTokenChanged }] = await Promise.all([
      getFirebaseAuth(),
      import('firebase/auth'),
    ]);
    if (cancelado) {
      return;
    }
    dejarDeEscuchar = onIdTokenChanged(auth, (usuario) => {
      if (!usuario) {
        alCambiar(null);
        return;
      }
      void usuario.getIdToken().then(alCambiar);
    });
  })();

  return () => {
    cancelado = true;
    dejarDeEscuchar?.();
  };
}
