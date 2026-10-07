package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.time.Instant;
import java.util.UUID;

/**
 * Public projection of a fleet unit (AC5): identity, state, position and zone,
 * plus the signal of its position feed (EP-04.F1.US1).
 *
 * <p><b>No driver id.</b> The fleet read is authenticated for EVERY role, so it
 * must not disclose who drives each unit: exposing {@code conductorId} here let
 * any authenticated citizen enumerate driver user ids. A driver resolves its
 * OWN unit from the server-scoped {@code GET /api/v1/flota/ambulancias/mia},
 * which only ever returns the caller's unit.
 *
 * <p><b>Signal.</b> {@code sinSenal} is {@code true} while the unit has gone
 * longer than the threshold without reporting; {@code ubicacion} is then its
 * last known position. {@code ultimaPosicionEn} is the instant of the last
 * accepted report, or {@code null} if it never reported.
 *
 * <p><b>Version.</b> {@code version} is the row version of this snapshot. The
 * frames of {@code /topic/flota} carry the same counter, so a client can tell
 * whether a frame it already received is newer than this read (design D6).
 *
 * <p><b>Connection.</b> {@code conectada} is {@code true} while the driver is
 * connected to the service (EP-04.F2.US1). Only a unit that is available,
 * connected and has signal receives a new request.
 */
public record AmbulanciaDto(UUID id, String placa, EstadoAmbulancia estado,
                            UbicacionDto ubicacion, String zona,
                            boolean sinSenal, Instant ultimaPosicionEn, long version,
                            boolean conectada) {

    public static AmbulanciaDto fromDomain(Ambulancia ambulancia) {
        return new AmbulanciaDto(
                ambulancia.getId(),
                ambulancia.getPlaca(),
                ambulancia.getEstado(),
                new UbicacionDto(ambulancia.getLat(), ambulancia.getLng()),
                ambulancia.getZona(),
                ambulancia.isSinSenal(),
                ambulancia.getUltimaPosicionEn(),
                ambulancia.getVersion(),
                ambulancia.isConectada());
    }
}
