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
