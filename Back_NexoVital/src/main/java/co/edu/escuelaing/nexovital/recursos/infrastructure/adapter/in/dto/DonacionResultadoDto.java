package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.recursos.domain.model.DonacionAceptada;
import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;

import java.util.UUID;

/**
 * Response of a donation: the {@link ItemInventarioDto} fields of the item
 * after the credit plus {@code cantidadAceptada} (what actually entered, capped
 * to the need) and {@code cantidadOfrecida} (what the donor offered). When both
 * differ, the donor completed the need with less than offered.
 */
public record DonacionResultadoDto(UUID id,
                                   UUID centroAcopioId,
                                   String nombre,
                                   int disponible,
                                   int requerido,
                                   Semaforo semaforo,
                                   int cantidadAceptada,
                                   int cantidadOfrecida) {

    public static DonacionResultadoDto fromDomain(DonacionAceptada donacion) {
        ItemInventarioDto item = ItemInventarioDto.fromDomain(donacion.item());
        return new DonacionResultadoDto(
                item.id(),
                item.centroAcopioId(),
                item.nombre(),
                item.disponible(),
                item.requerido(),
                item.semaforo(),
                donacion.aceptada(),
                donacion.solicitada());
    }
}
