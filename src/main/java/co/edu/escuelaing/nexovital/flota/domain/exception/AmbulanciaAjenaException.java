package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * The authenticated driver tried to act on a unit that is not theirs. It mirrors
 * the accept/reject/arrival actor checks: the client sends the unit id, so the
 * server must verify it belongs to the caller. The controller translates it to
 * {@code 409 AMBULANCIA_AJENA}.
 */
public class AmbulanciaAjenaException extends RuntimeException {

    public AmbulanciaAjenaException(UUID id) {
        super("Ambulance " + id + " does not belong to the authenticated driver");
    }
}
