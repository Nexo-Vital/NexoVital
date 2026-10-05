package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarAlertaEscasezUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.AlertaEscasezRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Persists the shortage alert of a rejected dispatch.
 *
 * <p><b>FA-6 — the alert must survive the dispatch rollback.</b> The dispatch
 * is {@code @Transactional} and <em>throws</em> to produce the {@code 409};
 * Spring then rolls the whole transaction back, including anything saved
 * inside it. Saving the alert in that same transaction and throwing afterwards
 * makes the alert vanish. Therefore this method runs in its OWN transaction
 * ({@code REQUIRES_NEW}): it suspends the dispatch transaction, commits the
 * alert, and the later rollback of the dispatch cannot touch it.
 *
 * <p>The rule here is the demand policy of the story:
 * <ul>
 *   <li>no record yet → create one (FA-2);</li>
 *   <li>record still active → keep the largest demand (FA-4);</li>
 *   <li>record already covered → start a new shortage cycle with the new
 *       demand and a fresh date (FA-3 traceability).</li>
 * </ul>
 * Whether an alert is active depends on the stock at read time, so it is not a
 * stored flag: it is computed by {@link AlertaEscasez#estaActiva(int)}.
 *
 * <p><b>One alert per item, even under a burst of rejections.</b> "Search, and
 * create when missing" is two steps, and N concurrent rejections of the same
 * item can all search before any of them creates. Three things close that race:
 * <ol>
 *   <li>the table allows a single row per {@code (center, item)}, so only one
 *       of the concurrent inserts succeeds;</li>
 *   <li>raising the demand and reopening a covered alert are conditional
 *       single-statement updates, so a smaller demand can never overwrite a
 *       larger one that was written in between;</li>
 *   <li>whoever loses any of those races tries again in a NEW transaction and
 *       then finds the row the winner left.</li>
 * </ol>
 * That is why the transaction is opened here by hand with a
 * {@link TransactionTemplate} instead of {@code @Transactional}: a retry needs
 * a fresh transaction per attempt, and an annotation gives exactly one.
 *
 * <p><b>Realtime push.</b> Whenever the alert actually changes, the attempt
 * publishes an {@link AlertaEscasezRegistradaEvento}. Because the publish
 * happens INSIDE the attempt's {@code REQUIRES_NEW} transaction, the
 * {@code AFTER_COMMIT} listener ({@link AlertaEscasezPushListener}) fires when
 * the ALERT commits, before the dispatch rolls back, and never for an attempt
 * that failed. A rejection that changes nothing (an active alert with a
 * same-or-larger demand) issues no write and therefore no event.
 */
@Service
public class RegistrarAlertaEscasezUseCaseImpl implements RegistrarAlertaEscasezUseCase {

    private static final Logger LOG = LoggerFactory.getLogger(RegistrarAlertaEscasezUseCaseImpl.class);

    /**
     * Attempts before giving up. One retry is enough for the insert race (the
     * second attempt finds the winner's row); the margin covers a lock timeout
     * under heavy contention.
     */
    static final int INTENTOS_MAXIMOS = 5;

    private final AlertaEscasezRepository alertaEscasezRepository;
    private final Clock clock;
    private final ApplicationEventPublisher eventPublisher;
    private final TransactionTemplate transaccionPropia;

    public RegistrarAlertaEscasezUseCaseImpl(AlertaEscasezRepository alertaEscasezRepository,
                                             Clock clock,
                                             ApplicationEventPublisher eventPublisher,
                                             PlatformTransactionManager transactionManager) {
        this.alertaEscasezRepository = alertaEscasezRepository;
        this.clock = clock;
        this.eventPublisher = eventPublisher;
        // FA-6: REQUIRES_NEW suspends the dispatch transaction, so the alert
        // commits on its own and survives the dispatch rollback.
        this.transaccionPropia = new TransactionTemplate(transactionManager);
        this.transaccionPropia.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public void registrar(UUID centroAcopioId, UUID itemId, String nombre, int cantidadSolicitada, int disponibleActual) {
        for (int intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
            try {
                Boolean resuelto = transaccionPropia.execute(estado ->
                        intentar(centroAcopioId, itemId, nombre, cantidadSolicitada, disponibleActual));
                if (Boolean.TRUE.equals(resuelto)) {
                    return;
                }
                // Another rejection changed the alert between our read and our
                // write: read it again in a new transaction.
            } catch (DataIntegrityViolationException | TransientDataAccessException carrera) {
                // Another rejection inserted the alert of this item first (unique
                // constraint), or the row was locked for too long. The failed
                // transaction is already rolled back; the next attempt starts clean.
                LOG.debug("Alerta de escasez en carrera (intento {} de {}) para el item {}",
                        intento, INTENTOS_MAXIMOS, itemId, carrera);
            }
        }
        // Never turn the 409 of the dispatch into a 500 because of the alert:
        // the rejection itself is correct. Losing every attempt means other
        // rejections of the same item were writing the alert the whole time.
        LOG.warn("No se pudo registrar la alerta de escasez del item {} tras {} intentos", itemId, INTENTOS_MAXIMOS);
    }

    /**
     * One attempt, inside its own transaction.
     *
     * @return {@code true} when the alert is settled (written, or correctly left
     *         as it was); {@code false} when someone else changed it in between
     *         and the caller has to try again
     */
    private boolean intentar(UUID centroAcopioId, UUID itemId, String nombre, int cantidadSolicitada, int disponibleActual) {
        Instant ahora = Instant.now(clock);
        Optional<AlertaEscasez> existente = alertaEscasezRepository.buscarMayorDemanda(centroAcopioId, itemId);

        if (existente.isEmpty()) {
            // Under a race only one insert passes the unique constraint; the
            // others throw and are retried by `registrar`.
            publicar(alertaEscasezRepository.crear(
                    AlertaEscasez.crear(centroAcopioId, itemId, nombre, cantidadSolicitada, ahora)), disponibleActual);
            return true;
        }

        AlertaEscasez actual = existente.get();
        if (actual.estaActiva(disponibleActual)) {
            // FA-4: only a LARGER demand may raise it; a smaller one is ignored.
            // A same-or-smaller demand issues no write at all, so a burst of
            // rejections of the same item does not hammer the row.
            AlertaEscasez peor = actual.conMayorDemanda(cantidadSolicitada);
            if (peor != actual && alertaEscasezRepository.subirDemandaSiEsMayor(actual.getId(), cantidadSolicitada)) {
                publicar(peor, disponibleActual);
            }
            // When the conditional update changed nothing, a concurrent rejection
            // already raised the demand to ours or beyond: nothing left to do.
            return true;
        }

        // The previous shortage was covered; this rejection opens a new one,
        // unless a concurrent rejection opened it first.
        if (alertaEscasezRepository.reactivarSiNoCambio(
                actual.getId(), actual.getCantidadSolicitada(), cantidadSolicitada, ahora)) {
            publicar(actual.reactivar(cantidadSolicitada, ahora), disponibleActual);
            return true;
        }
        return false;
    }

    /**
     * Publishes the alert only after it was persisted. The event is bound to the
     * current ({@code REQUIRES_NEW}) transaction, so its {@code AFTER_COMMIT}
     * listener runs when the alert commits, never on the dispatch rollback.
     */
    private void publicar(AlertaEscasez alerta, int disponibleActual) {
        eventPublisher.publishEvent(new AlertaEscasezRegistradaEvento(alerta, disponibleActual));
    }
}
