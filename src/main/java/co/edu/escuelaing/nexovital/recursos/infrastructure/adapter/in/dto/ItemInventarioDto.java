package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;

import java.util.UUID;

/**
 * Proyección pública de un item de inventario (contrato OpenAPI, schema
 * {@code InventarioItem}): {@code {id, centroAcopioId, nombre, disponible,
 * requerido, semaforo}}. La forma es EXACTA a la declarada: no se publican
 * campos que el contrato no fije.
 *
 * <p>{@code unidad} y {@code unitDetail} existen en el dominio (detalle de UI de
 * la mockup) pero NO se exponen aquí porque el schema del contrato no los
 * declara; agregarlos sería inventar campos en la API.
 */
public record ItemInventarioDto(UUID id,
                                UUID centroAcopioId,
                                String nombre,
                                int disponible,
                                int requerido,
                                Semaforo semaforo) {

    public static ItemInventarioDto fromDomain(ItemInventario item) {
        return new ItemInventarioDto(
                item.getId(),
                item.getCentroAcopioId(),
                item.getNombre(),
                item.getDisponible(),
                item.getRequerido(),
                item.semaforo());
    }
}
