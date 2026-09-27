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
 * <p>The event carries the ids of EVERY available unit in the zone, so the
 * post-commit listener fans the request out to each one (D-F1, AC1). The module
 * no longer knows a broker: it only publishes the domain event.
 */
@Service
public class SolicitarAmbulanciaUseCaseImpl implements SolicitarAmbulanciaUseCase {

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final long timeoutSegundos;

    public SolicitarAmbulanciaUseCaseImpl(SolicitudRepository solicitudRepository,
                                          AmbulanciaRepository ambulanciaRepository,
                                          ApplicationEventPublisher eventPublisher,
                                          @Value("${nexovital.solicitud.timeout-segundos:60}") long timeoutSegundos) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
        this.eventPublisher = eventPublisher;
        this.timeoutSegundos = timeoutSegundos;
    }

    @Override
    @Transactional
    public SolicitudAmbulancia solicitar(UUID emergenciaId, UUID centroAyudaId, String zonaId, Instant timeoutEn) {
        List<Ambulancia> disponibles = ambulanciaRepository.listarDisponiblesEnZona(zonaId);
        if (disponibles.isEmpty()) {
            throw new AmbulanciaNoDisponibleException(zonaId);
        }

        Instant solicitadaEn = Instant.now();
        Instant tope = timeoutEn != null ? timeoutEn : solicitadaEn.plus(timeoutSegundos, ChronoUnit.SECONDS);
        List<UUID> notificadas = disponibles.stream().map(Ambulancia::getId).toList();

        SolicitudAmbulancia solicitud = SolicitudAmbulancia.solicitar(
                UUID.randomUUID(), emergenciaId, centroAyudaId, zonaId, solicitadaEn, tope, notificadas);
        SolicitudAmbulancia guardada = solicitudRepository.guardar(solicitud);

        eventPublisher.publishEvent(new SolicitudCreadaEvent(
                guardada.getId(), emergenciaId, zonaId, notificadas, solicitadaEn));
        return guardada;
    }
}
