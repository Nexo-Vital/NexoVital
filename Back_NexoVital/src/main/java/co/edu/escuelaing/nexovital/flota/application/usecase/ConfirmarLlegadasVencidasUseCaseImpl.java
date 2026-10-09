package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudConfirmadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarLlegadasVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/** Confirms on the citizen's behalf an arrival left unanswered past the allowed time. */
@Service
public class ConfirmarLlegadasVencidasUseCaseImpl implements ConfirmarLlegadasVencidasUseCase {

    private final SolicitudRepository solicitudRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final Duration plazo;

    public ConfirmarLlegadasVencidasUseCaseImpl(SolicitudRepository solicitudRepository,
                                                ApplicationEventPublisher eventPublisher,
                                                Clock clock,
                                                @Value("${nexovital.solicitud.confirmacion-automatica-segundos:60}")
                                                long plazoSegundos) {
        this.solicitudRepository = solicitudRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
        this.plazo = Duration.ofSeconds(plazoSegundos);
    }

    @Override
    @Transactional
    public int confirmarVencidas() {
        Instant limite = Instant.now(clock).minus(plazo);
        List<SolicitudAmbulancia> sinConfirmar = solicitudRepository.listarLlegadasSinConfirmar(limite);

        int confirmadas = 0;
        for (SolicitudAmbulancia solicitud : sinConfirmar) {
            // Conditional update: a manual confirmation or a parallel sweep wins once.
            int filas = solicitudRepository.transicionAtomicaEstado(
                    solicitud.getId(), EstadoSolicitud.ASIGNADA, EstadoSolicitud.CONFIRMADA);
            if (filas == 0) {
                continue;
            }
            confirmadas++;
            eventPublisher.publishEvent(new SolicitudConfirmadaEvent(
                    solicitud.getId(), solicitud.getEmergenciaId(), solicitud.getZonaId(),
                    solicitud.getAmbulanciaAsignadaId(), solicitud.getSolicitanteId()));
        }
        return confirmadas;
    }
}
