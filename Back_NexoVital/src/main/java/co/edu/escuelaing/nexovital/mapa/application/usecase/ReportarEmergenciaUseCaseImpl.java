package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ReportarEmergenciaUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.EmergenciaRepository;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.ZonaRepository;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * Registra una emergencia: valida los campos, resuelve su zona a partir del
 * punto con el punto-en-poligono ya implementado (decision D4), la persiste y
 * publica el evento que el listener post-commit entrega al {@code PushPort}.
 *
 * <p><b>Reportar NO pide ambulancia.</b> El reporte de una zona afectada alerta
 * a los centros de ayuda cercanos (EP-02.F1.US3); pedir una ambulancia es otra
 * accion del ciudadano ({@code POST /solicitudes}, EP-04.F2.US1). Antes este
 * caso de uso creaba ademas la solicitud y el ciudadano quedaba "pidiendo
 * ambulancia" sin haberlo pedido.
 *
 * <p>Los push van DESPUES del commit (regla de oro del contrato): el evento se
 * consume con {@code @TransactionalEventListener(AFTER_COMMIT)} en {@link
 * EmergenciaPushListener}.
 */
@Service
public class ReportarEmergenciaUseCaseImpl implements ReportarEmergenciaUseCase {

    private final EmergenciaRepository emergenciaRepository;
    private final ZonaRepository zonaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final RegistroAuditoriaPort registroAuditoriaPort;

    public ReportarEmergenciaUseCaseImpl(EmergenciaRepository emergenciaRepository,
                                         ZonaRepository zonaRepository,
                                         ApplicationEventPublisher eventPublisher,
                                         Clock clock,
                                         RegistroAuditoriaPort registroAuditoriaPort) {
        this.emergenciaRepository = emergenciaRepository;
        this.zonaRepository = zonaRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
        this.registroAuditoriaPort = registroAuditoriaPort;
    }

    @Override
    @Transactional
    public EmergenciaReportada reportar(Ubicacion ubicacion, TipoEmergencia tipo, NivelEmergencia nivel,
                                        String descripcion, String direccion, UUID solicitanteId) {
        if (ubicacion == null) {
            throw new IllegalArgumentException("La ubicación es obligatoria.");
        }
        if (tipo == null) {
            throw new IllegalArgumentException("El tipo de emergencia es obligatorio.");
        }
        if (nivel == null) {
            throw new IllegalArgumentException("El nivel de emergencia es obligatorio.");
        }
        if (descripcion == null || descripcion.isBlank()) {
            throw new IllegalArgumentException("La descripción es obligatoria.");
        }

        Emergencia emergencia = new Emergencia(
                UUID.randomUUID(),
                ubicacion,
                tipo,
                nivel,
                EstadoEmergencia.REGISTRADA,
                descripcion,
                resolverZona(ubicacion),
                Instant.now(clock));

        Emergencia guardada = emergenciaRepository.guardar(emergencia);
        // Bitácora en la MISMA transacción: si el reporte commitea y esto no, la
        // traza mentiría por omisión (Sprint 2, T14).
        registroAuditoriaPort.registrar(EventoAuditoria.nuevo(
                AccionCritica.EMERGENCIA_REPORTADA,
                EventoAuditoria.TIPO_EMERGENCIA,
                guardada.getId(),
                solicitanteId,
                detalleEmergencia(guardada),
                Instant.now(clock)));
        eventPublisher.publishEvent(new EmergenciaRegistradaEvento(guardada));

        // Reportar no despacha: la ambulancia se pide aparte (POST /solicitudes).
        return new EmergenciaReportada(guardada, null);
    }

    /**
     * Resuelve la zona del punto recorriendo el catalogo y aplicando
     * {@link Zona#contiene(Ubicacion)} (decision D4). Devuelve el id de la
     * primera zona que contiene el punto, o {@code null} si no cae en ninguna:
     * el reporte se acepta igual.
     */
    private String resolverZona(Ubicacion punto) {
        return zonaRepository.listar().stream()
                .filter(zona -> zona.contiene(punto))
                .map(Zona::getId)
                .findFirst()
                .orElse(null);
    }

    private static String detalleEmergencia(Emergencia emergencia) {
        return "tipo=" + emergencia.getTipo()
                + " nivel=" + emergencia.getNivel()
                + " zona=" + (emergencia.getZonaId() == null ? "-" : emergencia.getZonaId());
    }
}
