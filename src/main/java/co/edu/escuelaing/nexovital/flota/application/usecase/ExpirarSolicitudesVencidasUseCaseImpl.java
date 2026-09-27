package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudExpiradaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;

/**
 * Expires the requests nobody attended within their window (EP-04.F2.US9).
 *
 * <p><b>Scope of the window.</b> Expiry is about the request as a whole, not a
 * per-unit countdown: the request carries one {@code timeoutEn} ("tope para el
 * primer accept", the broadcast's temporal lock) and, while it is PENDIENTE,
 * the first accept that arrives wins. When the window closes with no winner the
 * whole request dies for every notified unit at once; none of them was occupied
 * (only a winner enters EN_MISION), so they all stay {@code DISPONIBLE} and can
 * be notified by a new request.
 *
 * <p><b>Idempotent and race-safe.</b> The close is a conditional update
 * ({@code WHERE estado = PENDIENTE AND timeoutEn < :ahora}); a request already
 * accepted or already expired yields 0 rows and is skipped, and two concurrent
 * sweeps cannot both emit the expiry event. The events are published inside the
 * transaction and delivered by the {@code AFTER_COMMIT} listener.
 */
@Service
public class ExpirarSolicitudesVencidasUseCaseImpl implements ExpirarSolicitudesVencidasUseCase {

    private final SolicitudRepository solicitudRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;

    public ExpirarSolicitudesVencidasUseCaseImpl(SolicitudRepository solicitudRepository,
                                                 ApplicationEventPublisher eventPublisher,
                                                 Clock clock) {
        this.solicitudRepository = solicitudRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    @Override
    @Transactional
    public int expirarVencidas() {
        Instant ahora = Instant.now(clock);
        List<SolicitudAmbulancia> vencidas = solicitudRepository.listarPendientesVencidas(ahora);

        int expiradas = 0;
        for (SolicitudAmbulancia solicitud : vencidas) {
            int filas = solicitudRepository.transicionAtomicaExpirar(
                    solicitud.getId(), EstadoSolicitud.PENDIENTE, EstadoSolicitud.TIMEOUT, ahora);
            if (filas == 0) {
                continue;
            }
            expiradas++;
            eventPublisher.publishEvent(new SolicitudExpiradaEvent(
                    solicitud.getId(), solicitud.getEmergenciaId(), solicitud.getZonaId(),
                    solicitud.getAmbulanciasNotificadas(), solicitud.getSolicitanteId()));
        }
        return expiradas;
    }
}
