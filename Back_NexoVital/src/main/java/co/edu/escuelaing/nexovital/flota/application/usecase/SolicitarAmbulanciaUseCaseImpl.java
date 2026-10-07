package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudCreadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
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
 * Creates the request in PENDIENTE, persists it and publishes
 * {@link SolicitudCreadaEvent}. The event is delivered to the broker ONLY after
 * commit: the service publishes inside the transaction and the
 * {@link FlotaPushListener} listens in {@code AFTER_COMMIT} (golden rule:
 * publish POST-COMMIT).
 *
 * <p>The accept window is SERVER-OWNED: the deadline is computed here from the
 * server clock and the configured {@code nexovital.solicitud.timeout-segundos}.
 * The client never proposes a timeout, so a skewed client clock can never
 * create an already-expired request.
 *
 * <p><b>The broadcast has no zone filter.</b> The event carries the ids of EVERY
 * available unit — the request no longer depends on an affected zone, and the
 * zone is only a map warning. The class of the professor's description ("all
 * ambulances accept and only one wins") is delivered by the CAS on accept, not
 * by narrowing who is notified. The module no longer knows a broker: it only
 * publishes the domain event.
 */
@Service
public class SolicitarAmbulanciaUseCaseImpl implements SolicitarAmbulanciaUseCase {

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final long timeoutSegundos;

    public SolicitarAmbulanciaUseCaseImpl(SolicitudRepository solicitudRepository,
                                          AmbulanciaRepository ambulanciaRepository,
                                          ApplicationEventPublisher eventPublisher,
                                          Clock clock,
                                          @Value("${nexovital.solicitud.timeout-segundos:60}") long timeoutSegundos) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
        this.timeoutSegundos = timeoutSegundos;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia solicitar(double lat, double lng, UUID emergenciaId, UUID centroAyudaId,
                                         String zonaId, UUID solicitanteId) {
        List<Ambulancia> disponibles = ambulanciaRepository.listarDisponibles();
        if (disponibles.isEmpty()) {
            throw new AmbulanciaNoDisponibleException();
        }

        Instant solicitadaEn = Instant.now(clock);
        Instant tope = solicitadaEn.plus(timeoutSegundos, ChronoUnit.SECONDS);
        List<UUID> notificadas = disponibles.stream().map(Ambulancia::getId).toList();

        SolicitudAmbulancia solicitud = SolicitudAmbulancia.solicitar(
                UUID.randomUUID(), lat, lng, emergenciaId, centroAyudaId, zonaId, solicitadaEn, tope,
                solicitanteId, notificadas);
        SolicitudAmbulancia guardada = solicitudRepository.guardar(solicitud);

        eventPublisher.publishEvent(new SolicitudCreadaEvent(
                guardada.getId(), guardada.getLat(), guardada.getLng(), emergenciaId, zonaId,
                notificadas, solicitadaEn, guardada.getTimeoutEn(), guardada.getSolicitanteId()));
        return guardada;
    }
}