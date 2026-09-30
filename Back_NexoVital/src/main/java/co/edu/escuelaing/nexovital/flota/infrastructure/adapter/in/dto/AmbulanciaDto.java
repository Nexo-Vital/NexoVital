package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.UUID;

/**
 * Public projection of a fleet unit (AC5): identity, state, position and zone.
 *
 * <p><b>No driver id.</b> The fleet read is authenticated for EVERY role, so it
 * must not disclose who drives each unit: exposing {@code conductorId} here let
 * any authenticated citizen enumerate driver user ids. A driver resolves its
 * OWN unit from the server-scoped {@code GET /api/v1/flota/ambulancias/mia},
 * which only ever returns the caller's unit.
 */
public record AmbulanciaDto(UUID id, String placa, EstadoAmbulancia estado,
                            UbicacionDto ubicacion, String zona) {

    public static AmbulanciaDto fromDomain(Ambulancia ambulancia) {
        return new AmbulanciaDto(
                ambulancia.getId(),
                ambulancia.getPlaca(),
                ambulancia.getEstado(),
                new UbicacionDto(ambulancia.getLat(), ambulancia.getLng()),
                ambulancia.getZona());
    }
}
