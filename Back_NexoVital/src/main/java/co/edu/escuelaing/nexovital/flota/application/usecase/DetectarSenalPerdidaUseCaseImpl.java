package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.event.PosicionActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DetectarSenalPerdidaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Marks the units that stopped reporting (EP-04.F1.US1, scenario 4, design D5).
 *
 * <p><b>Rule.</b> A unit has lost its signal when its last accepted report is
 * older than the threshold ({@code nexovital.flota.senal.umbral-ms}, 30 s by
 * default). A unit that never reported is not marked. The mark is data: the
 * unit keeps its {@code estado} and its last known position.
 *
 * <p><b>Idempotent and race-safe.</b> The mark is a conditional UPDATE
 * ({@code WHERE sinSenal = false AND ultimaPosicionEn < :limite}):
 * <ul>
 *   <li>a unit already marked yields 0 rows, so the notice is published once and
 *       two concurrent sweeps cannot both emit it;</li>
 *   <li>a report that lands at the same moment competes for the row lock. If the
 *       report wins, this yields 0 rows; if this wins, the report clears the
 *       mark right after. Either way the row ends with signal.</li>
 * </ul>
 *
 * <p><b>Order on the wire.</b> The notice carries the row version read after the
 * mark, inside this transaction. If the notice and a later report reach the
 * channel inverted, the consumer discards the notice because its version is
 * lower (D6).
 *
 * <p>The events are published inside the transaction and delivered by the
 * {@code AFTER_COMMIT} listener, like every fleet event.
 */
@Service
public class DetectarSenalPerdidaUseCaseImpl implements DetectarSenalPerdidaUseCase {

    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final Duration umbral;

    public DetectarSenalPerdidaUseCaseImpl(AmbulanciaRepository ambulanciaRepository,
                                           ApplicationEventPublisher eventPublisher,
                                           Clock clock,
                                           @Value("${nexovital.flota.senal.umbral-ms:30000}") long umbralMs) {
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
        this.umbral = Duration.ofMillis(umbralMs);
    }

    @Override
    @Transactional
    public int detectar() {
        // Strictly older than the limit: "más de 30 segundos sin reportar".
        Instant limite = Instant.now(clock).minus(umbral);
        List<Ambulancia> vencidas = ambulanciaRepository.listarConSenalVencida(limite);

        int marcadas = 0;
        for (Ambulancia unidad : vencidas) {
            int filas = ambulanciaRepository.marcarSinSenalAtomica(unidad.getId(), limite);
            if (filas == 0) {
                // It reported again, or another sweep marked it first.
                continue;
            }

            // Re-read AFTER the mark, under the row lock: the position is the
            // last one the unit reported and the version is the one this mark
            // produced.
            Optional<Ambulancia> marcada = ambulanciaRepository.buscarPorId(unidad.getId());
            if (marcada.isEmpty()) {
                continue;
            }
            Ambulancia actual = marcada.get();
            marcadas++;
            eventPublisher.publishEvent(new PosicionActualizadaEvent(
                    actual.getId(), actual.getLat(), actual.getLng(), actual.getEstado(),
                    null, actual.getFuentePosicion(), true,
                    actual.getUltimaPosicionEn(), actual.getVersion()));
        }
        return marcadas;
    }
}
