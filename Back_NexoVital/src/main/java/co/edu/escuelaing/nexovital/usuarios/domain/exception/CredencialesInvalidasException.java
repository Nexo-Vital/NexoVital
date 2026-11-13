package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/**
 * Contraseña incorrecta. Se traduce a {@code 401} con código
 * {@code CREDENCIALES_INVALIDAS}.
 */
public class CredencialesInvalidasException extends RuntimeException {

    public CredencialesInvalidasException() {
        super("Credenciales inválidas.");
    }

    /**
     * Variante con detalle, para el validador de tokens del IdP: el mensaje
     * explica qué falló (firma, audiencia, expiración) sin filtrar el token.
     */
    public CredencialesInvalidasException(String detalle) {
        super(detalle);
    }
}
