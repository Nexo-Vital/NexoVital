package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudExpiradaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudReintentadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * Sweeps the requests nobody attended within their window (EP-04.F2.US9) and,
 * since US4, RETRIES them before giving up (EP-04.F2.US4).
 *
 * <p><b>Retry before timeout.</b> When a PENDIENTE request's window closes with
 * no winner, the sweep re-emits it to the units available RIGHT NOW (new window,
 * new notified set) while it still has retries left and there is at least one
 * available unit. Only when the retries are exhausted — or no unit is available —
 * does it expire exactly as before ({@code TIMEOUT}). This is what lets a driver
 * who reconnected after the first emission still see the request.
 *
 * <p><b>Why re-emit to the whole available set.</b> The repo's broadcast has no
 * zone/radio filter by design (creation notifies EVERY available unit), so the
 * story's "widen the search radius" is delivered as re-emitting to the current
 * available units: that is already the widest radius the system knows. Documented
 * deviation, not a bug.
 *
 * <p><b>Idempotent and race-safe.</b> Both the retry and the expiry are
 * conditional updates ({@code WHERE estado = PENDIENTE AND timeoutEn < :ahora}
 * plus {@code reintentos < :max} for the retry). A request already accepted, or
 * already handled by a concurrent sweep, yields 0 rows and is skipped; two
 * concurrent sweeps cannot both emit a retry or an expiry. Events are published
 * inside the transaction and delivered by the {@code AFTER_COMMIT} listener.
 */
@Service
public class ExpirarSolicitudesVencidasUseCaseImpl implements ExpirarSolicitudesVencidasUseCase {

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final int maxReintentos;
    private final long timeoutSegundos;

    public ExpirarSolicitudesVencidasUseCaseImpl(SolicitudRepository solicitudRepository,
                                                 AmbulanciaRepository ambulanciaRepository,
                                                 ApplicationEventPublisher eventPublisher,
                                                 Clock clock,
                                                 @Value("${nexovital.solicitud.max-reintentos:2}") int maxReintentos,
                                                 @Value("${nexovital.solicitud.timeout-segundos:60}") long timeoutSegundos) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
        this.maxReintentos = maxReintentos;
        this.timeoutSegundos = timeoutSegundos;
    }

    @Override
    @Transactional
    public int expirarVencidas() {
        Instant ahora = Instant.now(clock);
        List<SolicitudAmbulancia> vencidas = solicitudRepository.listarPendientesVencidas(ahora);

        int expiradas = 0;
        for (SolicitudAmbulancia solicitud : vencidas) {
            if (reintentarSiProcede(solicitud, ahora)) {
                continue;
            }
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

    /**
     * Re-emits the request when it still has retries and a unit is available.
     *
     * @return true when the request must be skipped from expiry: it was retried,
     *         OR a concurrent sweep/accept already handled it (the CAS returned 0)
     */
    private boolean reintentarSiProcede(SolicitudAmbulancia solicitud, Instant ahora) {
        if (solicitud.getReintentos() >= maxReintentos) {
            return false;
        }
        List<Ambulancia> disponibles = ambulanciaRepository.listarDisponibles();
        if (disponibles.isEmpty()) {
            return false;
        }
        List<UUID> notificadas = disponibles.stream().map(Ambulancia::getId).toList();
        Instant nuevoTimeoutEn = ahora.plus(timeoutSegundos, ChronoUnit.SECONDS);

        int filas = solicitudRepository.reintentarAtomico(
                solicitud.getId(), EstadoSolicitud.PENDIENTE, nuevoTimeoutEn, notificadas,
                maxReintentos, ahora);
        if (filas == 0) {
            // Lost the race: another sweep retried it, or an accept moved the
            // request. Either way it must not be expired by this call.
            return true;
        }
        eventPublisher.publishEvent(new SolicitudReintentadaEvent(
                solicitud.getId(), solicitud.getLat(), solicitud.getLng(), solicitud.getEmergenciaId(),
                solicitud.getZonaId(), notificadas, nuevoTimeoutEn,
                solicitud.getReintentos() + 1, solicitud.getSolicitanteId()));
        return true;
    }
}
