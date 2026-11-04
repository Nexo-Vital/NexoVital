package co.edu.escuelaing.nexovital.flota.domain.exception;

import java.util.UUID;

/**
 * The authenticated driver tried to act on a unit that is not theirs. It mirrors
 * the accept/reject/arrival actor checks: the client sends the unit id, so the
 * server must verify it belongs to the caller. The controller translates it to
 * {@code 403 AMBULANCIA_AJENA}.
 *
 * <p>Es 403 y no 409: el recurso existe y el estado lo permite, lo que falta es
 * el permiso. Un 409 invita a reintentar; acá reintentar nunca va a funcionar.
 */
public class AmbulanciaAjenaException extends RuntimeException {

    public AmbulanciaAjenaException(UUID id) {
        super("Ambulance " + id + " does not belong to the authenticated driver");
    }
}
