package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.Ubicacion;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.event.ConexionUnidadEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.FlotaActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SenalRecuperadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.IncorporarUnidadASolicitudesAbiertasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.NombreUsuarioPort;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.List;
import java.util.UUID;

/**
 * Offers the requests that are still open to a unit the moment it becomes able
 * to receive them (EP-04.F2.US1).
 *
 * <p>A unit becomes eligible in four ways, and each one already publishes an
 * event:
 * <ul>
 *   <li>it finishes its service, or declares itself available again
 *       ({@link FlotaActualizadaEvent} with {@code DISPONIBLE});</li>
 *   <li>it connects ({@link ConexionUnidadEvent});</li>
 *   <li>it recovers its signal ({@link SenalRecuperadaEvent}).</li>
 * </ul>
 * The events only say that something changed. Whether the unit really is
 * eligible (available AND connected AND with signal) is read from the database
 * by the use case, so a disconnection, or a unit that went out of service, adds
 * nothing.
 *
 * <p><b>After commit, and first.</b> It runs {@code AFTER_COMMIT}, like every
 * push of the module, and before the listeners that announce the unit's new
 * state on {@code /topic/flota}. The driver console reads its pending requests
 * when it sees its unit available: by then the unit is already among the
 * notified units.
 *
 * <p><b>The frame.</b> The driver receives the same {@code PENDIENTE} frame a
 * new request produces, plus {@code solicitadaEn} and {@code timeoutEn}: the
 * request is not new, so the console must count down the time it really has
 * left, not a full window.
 *
 * <p>A failure here never reaches the operation that triggered it: that
 * operation is already committed, and the driver can still read the open
 * requests from the pending endpoint.
 */
@Component
public class SolicitudAbiertaPushListener {

    private static final Logger LOG = LoggerFactory.getLogger(SolicitudAbiertaPushListener.class);

    private final IncorporarUnidadASolicitudesAbiertasUseCase incorporarUseCase;
    private final AmbulanciaRepository ambulanciaRepository;
    private final PushPort pushPort;
    private final NombreUsuarioPort nombreUsuarioPort;

    public SolicitudAbiertaPushListener(IncorporarUnidadASolicitudesAbiertasUseCase incorporarUseCase,
                                        AmbulanciaRepository ambulanciaRepository,
                                        PushPort pushPort,
                                        NombreUsuarioPort nombreUsuarioPort) {
        this.incorporarUseCase = incorporarUseCase;
        this.ambulanciaRepository = ambulanciaRepository;
        this.pushPort = pushPort;
        this.nombreUsuarioPort = nombreUsuarioPort;
    }

    /** The unit finished its service or declared itself available again. */
    @Order(Ordered.HIGHEST_PRECEDENCE)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alActualizarFlota(FlotaActualizadaEvent evento) {
        if (evento.estado() == EstadoAmbulancia.DISPONIBLE) {
            ofrecerAbiertas(evento.ambulanciaId());
        }
    }

    /** The unit connected. A disconnection is filtered out by the use case. */
    @Order(Ordered.HIGHEST_PRECEDENCE)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alCambiarConexion(ConexionUnidadEvent evento) {
        ofrecerAbiertas(evento.ambulanciaId());
    }

    /** The unit reported again after having lost its signal. */
    @Order(Ordered.HIGHEST_PRECEDENCE)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRecuperarSenal(SenalRecuperadaEvent evento) {
        ofrecerAbiertas(evento.ambulanciaId());
    }

    private void ofrecerAbiertas(UUID ambulanciaId) {
        try {
            List<SolicitudAmbulancia> incorporadas = incorporarUseCase.incorporar(ambulanciaId);
            if (incorporadas.isEmpty()) {
                return;
            }
            UUID conductorId = ambulanciaRepository.buscarPorId(ambulanciaId)
                    .map(Ambulancia::getConductorId)
                    .orElse(null);
            if (conductorId == null) {
                return;
            }
            for (SolicitudAmbulancia solicitud : incorporadas) {
                pushPort.publicarAUsuario(conductorId.toString(),
                        FlotaPushListener.DESTINO_SOLICITUDES, SolicitudAbiertaPushPayload.desde(
                                solicitud, nombreUsuarioPort.nombreDe(solicitud.getSolicitanteId())));
            }
        } catch (RuntimeException e) {
            LOG.warn("No se pudieron ofrecer las solicitudes abiertas a la unidad {}", ambulanciaId, e);
        }
    }

    /**
     * The request frame of {@link FlotaPushListener.SolicitudPushPayload} plus
     * the two instants of the request, as ISO-8601 text so the wire format does
     * not depend on how the message converter writes dates.
     */
    public record SolicitudAbiertaPushPayload(UUID solicitudId, Ubicacion ubicacion, UUID emergenciaId,
                                              String zonaId, String estado,
                                              List<UUID> ambulanciasNotificadas,
                                              UUID ambulanciaAsignadaId, boolean llegada,
                                              String solicitadaEn, String timeoutEn,
                                              String direccion, String solicitanteNombre) {

        static SolicitudAbiertaPushPayload desde(SolicitudAmbulancia solicitud, String solicitanteNombre) {
            return new SolicitudAbiertaPushPayload(
                    solicitud.getId(),
                    new Ubicacion(solicitud.getLat(), solicitud.getLng()),
                    solicitud.getEmergenciaId(),
                    solicitud.getZonaId(),
                    "PENDIENTE",
                    solicitud.getAmbulanciasNotificadas(),
                    null,
                    false,
                    solicitud.getSolicitadaEn() == null ? null : solicitud.getSolicitadaEn().toString(),
                    solicitud.getTimeoutEn() == null ? null : solicitud.getTimeoutEn().toString(),
                    solicitud.getDireccion(),
                    solicitanteNombre);
        }
    }
}
