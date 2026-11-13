package co.edu.escuelaing.nexovital.usuarios.domain.port.in;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;

/**
 * Resuelve la sesión a partir del Bearer token, sea cual sea el proveedor de
 * identidad.
 *
 * <p>Existe para que el filtro HTTP y el interceptor STOMP no sepan si detrás
 * hay un login local o un IdP externo. Cuando el proyecto se migre del todo,
 * solo desaparece la implementación local: los dos puntos de entrada no cambian.
 */
@FunctionalInterface
public interface ResolutorSesion {

    /**
     * @return el usuario autenticado, con su rol leído de la base
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException
     *         si el token no verifica
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException
     *         si el token es válido pero no corresponde a ningún usuario
     */
    Usuario resolver(String token);
}
