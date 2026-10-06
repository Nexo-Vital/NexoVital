package co.edu.escuelaing.nexovital.recursos.domain.exception;

/**
 * El administrador ya tiene un centro: no puede crear un segundo. El controlador
 * la traduce a {@code 409 CENTRO_YA_REGISTRADO}.
 */
public class CentroYaRegistradoException extends RuntimeException {

    public CentroYaRegistradoException() {
        super("El administrador ya tiene un centro registrado.");
    }
}
