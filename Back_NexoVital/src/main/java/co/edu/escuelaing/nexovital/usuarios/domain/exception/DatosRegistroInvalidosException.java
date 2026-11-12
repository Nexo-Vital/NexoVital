package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/** Faltan datos del registro o no tienen el formato esperado (por ejemplo, la placa). */
public class DatosRegistroInvalidosException extends RuntimeException {

    public DatosRegistroInvalidosException(String mensaje) {
        super(mensaje);
    }
}
