package co.edu.escuelaing.nexovital.mapa.domain.exception;

import java.util.UUID;

/**
 * No existe una emergencia con el identificador buscado. El módulo {@code mapa}
 * la lanza al actualizar y el controlador la traduce a {@code 404} con el
 * envelope {@code {codigo, mensaje}} (decisión D7 del ODD).
 *
 * <p>Es propia del módulo: la persistencia devuelve {@code Optional.empty()} y
 * el dominio decide qué significa "no encontrada", sin filtrar un detalle de
 * JPA.
 */
public class EmergenciaNoEncontradaException extends RuntimeException {

    public EmergenciaNoEncontradaException(UUID id) {
        super("Emergencia no encontrada: " + id);
    }
}
