package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/** La cuenta de Google o su correo ya tienen un usuario en NexoVital. */
public class UsuarioYaRegistradoException extends RuntimeException {

    public UsuarioYaRegistradoException() {
        super("Esta cuenta ya está registrada. Inicia sesión.");
    }
}
