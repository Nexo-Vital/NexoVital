package co.edu.escuelaing.nexovital.recursos.domain.exception;

/**
 * El administrador todavía no creó su centro. El controlador la traduce a
 * {@code 404 CENTRO_NO_REGISTRADO}.
 */
public class CentroPropioNoEncontradoException extends RuntimeException {

    public CentroPropioNoEncontradoException() {
        super("El administrador todavía no tiene un centro registrado.");
    }
}
