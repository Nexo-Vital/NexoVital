package co.edu.escuelaing.nexovital.flota.domain.port.in;

/**
 * Closes the requests whose accept window elapsed without a winner
 * (EP-04.F2.US9). It is driven by the scheduler, not by a client.
 */
public interface ExpirarSolicitudesVencidasUseCase {

    /**
     * Expires every PENDIENTE request whose {@code timeoutEn} already passed.
     * The transition is a conditional update, so it is idempotent and safe
     * against a parallel accept: only the call that actually closes a request
     * emits its post-commit event.
     *
     * @return how many requests this call expired
     */
    int expirarVencidas();
}
