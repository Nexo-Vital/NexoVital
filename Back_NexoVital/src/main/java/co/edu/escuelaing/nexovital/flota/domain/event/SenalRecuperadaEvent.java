package co.edu.escuelaing.nexovital.flota.domain.event;

import java.util.UUID;

/**
 * A unit that had lost its signal reported a position again (EP-04.F2.US1).
 *
 * <p>The position frame already tells the map that the unit is back. This event
 * exists for a different reader: a unit without signal is not offered new
 * requests, so the moment it recovers it must be offered the ones that are
 * still open. It is published inside the transaction of the report and only on
 * the report that actually brings the signal back, never on every position.
 */
public record SenalRecuperadaEvent(UUID ambulanciaId) {
}
