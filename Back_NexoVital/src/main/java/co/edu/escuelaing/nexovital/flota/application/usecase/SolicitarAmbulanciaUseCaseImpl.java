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
 * <p><b>Who is notified (EP-04.F2.US1, D5).</b> The event carries the ids of
 * the CANDIDATES of that instant: every unit that is available, connected and
 * has signal. A unit in a mission, en route, in maintenance, disconnected or
 * without signal is never notified. The list is fixed at creation and is never
 * extended afterwards.
 *
 * <p><b>The broadcast has no zone filter.</b> The request no longer depends on
 * an affected zone, and the zone is only a map warning. The class of the
 * professor's description ("all ambulances accept and only one wins") is
 * delivered by the CAS on accept, not by narrowing who is notified. The module
 * no longer knows a broker: it only publishes the domain event.
 *
 * <p><b>No lock on the fleet.</b> A unit that connects or disconnects while the
 * request is being created does not need one. The list is the snapshot of the
 * query; a unit that disconnects right after it stays in the list, but it can
 * neither see the request nor accept it, because the accept re-checks the
 * connection in its own conditional UPDATE.
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
    public SolicitudAmbulancia solicitar(double lat, double lng, UUID emergenciaId, UUID centroAyudaId,
                                         String zonaId, UUID solicitanteId, Instant timeoutEn,
                                         String direccion) {
        List<Ambulancia> candidatas = ambulanciaRepository.listarCandidatasParaSolicitud();
        if (candidatas.isEmpty()) {
            throw new AmbulanciaNoDisponibleException();
        }

        Instant solicitadaEn = Instant.now();
        Instant tope = timeoutEn != null ? timeoutEn : solicitadaEn.plus(timeoutSegundos, ChronoUnit.SECONDS);
        List<UUID> notificadas = candidatas.stream().map(Ambulancia::getId).toList();

        SolicitudAmbulancia solicitud = SolicitudAmbulancia.solicitar(
                UUID.randomUUID(), lat, lng, emergenciaId, centroAyudaId, zonaId, solicitadaEn, tope,
                solicitanteId, notificadas).conDireccion(direccion);
        SolicitudAmbulancia guardada = solicitudRepository.guardar(solicitud);

        eventPublisher.publishEvent(new SolicitudCreadaEvent(
                guardada.getId(), guardada.getLat(), guardada.getLng(), emergenciaId, zonaId,
                notificadas, solicitadaEn, guardada.getSolicitanteId(), tope, guardada.getDireccion()));
        return guardada;
    }
}
