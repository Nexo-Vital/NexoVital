package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/**
 * Contraseña incorrecta. Se traduce a {@code 401} con código
 * {@code CREDENCIALES_INVALIDAS}.
 */
public class CredencialesInvalidasException extends RuntimeException {

    public CredencialesInvalidasException() {
        super("Credenciales inválidas.");
    }
}
