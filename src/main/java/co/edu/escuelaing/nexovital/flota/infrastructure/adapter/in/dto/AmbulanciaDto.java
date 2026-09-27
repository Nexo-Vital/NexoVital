package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.UUID;

/**
 * Public projection of a fleet unit (AC5): identity, state, position and zone.
 *
 * <p>{@code conductorId} is the driver user id the unit is linked to
 * ({@code Ambulancia.conductorId}). It is exposed so a driver can resolve its OWN
 * unit from {@code GET /api/v1/flota/ambulancias} — the winner the server pushes
 * is a real ambulance id, so with a real backend the driver cannot recognise
 * itself from the demo labels. It carries no name or credential, only the same
 * user id the per-user push already addresses (D-F1); a unit with no driver
 * serializes it as {@code null}.
 */
public record AmbulanciaDto(UUID id, String placa, EstadoAmbulancia estado,
                            UbicacionDto ubicacion, String zona, UUID conductorId) {

    public static AmbulanciaDto fromDomain(Ambulancia ambulancia) {
        return new AmbulanciaDto(
                ambulancia.getId(),
                ambulancia.getPlaca(),
                ambulancia.getEstado(),
                new UbicacionDto(ambulancia.getLat(), ambulancia.getLng()),
                ambulancia.getZona(),
                ambulancia.getConductorId());
    }
}
