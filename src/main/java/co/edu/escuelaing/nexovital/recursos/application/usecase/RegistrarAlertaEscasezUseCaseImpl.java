package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarAlertaEscasezUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.AlertaEscasezRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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
 */
@Service
public class RegistrarAlertaEscasezUseCaseImpl implements RegistrarAlertaEscasezUseCase {

    private final AlertaEscasezRepository alertaEscasezRepository;
    private final Clock clock;

    public RegistrarAlertaEscasezUseCaseImpl(AlertaEscasezRepository alertaEscasezRepository, Clock clock) {
        this.alertaEscasezRepository = alertaEscasezRepository;
        this.clock = clock;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void registrar(UUID centroAcopioId, UUID itemId, String nombre, int cantidadSolicitada, int disponibleActual) {
        Instant ahora = Instant.now(clock);
        Optional<AlertaEscasez> existente = alertaEscasezRepository.buscarMayorDemanda(centroAcopioId, itemId);

        if (existente.isEmpty()) {
            alertaEscasezRepository.guardar(AlertaEscasez.crear(centroAcopioId, itemId, nombre, cantidadSolicitada, ahora));
            return;
        }

        AlertaEscasez actual = existente.get();
        if (actual.estaActiva(disponibleActual)) {
            // FA-4: only a LARGER demand may raise it; a smaller one is ignored.
            // A same-or-smaller demand returns the same instance, so no write is
            // issued: under a burst of rejections of the same item this avoids
            // hammering the same row.
            AlertaEscasez peor = actual.conMayorDemanda(cantidadSolicitada);
            if (peor != actual) {
                alertaEscasezRepository.guardar(peor);
            }
            return;
        }
        // The previous shortage was covered; this rejection opens a new one.
        alertaEscasezRepository.guardar(actual.reactivar(cantidadSolicitada, ahora));
    }
}
