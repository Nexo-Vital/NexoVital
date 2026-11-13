package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/**
 * El token del IdP externo es válido, pero esa cuenta todavía no tiene usuario
 * en NexoVital: debe completar el registro eligiendo su rol.
 *
 * <p>Extiende {@link UsuarioNoEncontradoException} para que todo el código que
 * ya trata "sin usuario" como no autenticado (el filtro HTTP y el CONNECT del
 * WebSocket) lo siga rechazando igual. Solo el punto de entrada de seguridad lo
 * distingue, para responder 401 con el código {@code USUARIO_NO_REGISTRADO} y
 * que el front lleve a la pantalla de registro.
 */
public class UsuarioNoRegistradoException extends UsuarioNoEncontradoException {

    public UsuarioNoRegistradoException(String uid) {
        super("cuenta sin registro (uid " + uid + ")");
    }
}
