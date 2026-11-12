package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/**
 * Ya existe un vehículo con esa placa. También cubre la carrera de dos
 * conductores que se registran con la misma placa al mismo tiempo: la clave
 * primaria de {@code flota.placas} deja pasar solo a uno.
 */
public class PlacaDuplicadaException extends RuntimeException {

    public PlacaDuplicadaException(String placa) {
        super("Ya hay un vehículo registrado con la placa " + placa + ".");
    }
}
