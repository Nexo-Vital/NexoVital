package co.edu.escuelaing.nexovital.recursos.domain.exception;

/**
 * Ya existe un centro con el nombre pedido. El controlador la traduce a
 * {@code 409 NOMBRE_CENTRO_DUPLICADO}.
 */
public class NombreCentroDuplicadoException extends RuntimeException {

    public NombreCentroDuplicadoException(String nombre) {
        super("Ya existe un centro con el nombre: " + nombre);
    }
}
