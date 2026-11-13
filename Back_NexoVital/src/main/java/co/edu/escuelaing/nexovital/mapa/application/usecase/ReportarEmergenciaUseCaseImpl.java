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
import co.edu.escuelaing.nexovital.mapa.domain.port.out.DespachoAmbulanciaPort;
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
 * Registra una emergencia y DISPARA el despacho de su ambulancia: valida los
 * campos, resuelve su zona a partir del punto con el punto-en-poligono ya
 * implementado (decision D4), la persiste, publica el evento que el listener
 * post-commit entrega al {@code PushPort} y pide la ambulancia.
 *
 * <p><b>El disparador vive en el backend.</b> Antes el front reportaba la
 * emergencia y despues llamaba {@code POST /solicitudes}: la decision era del
 * cliente. Ahora el mismo acto de reportar crea la solicitud, y el cliente solo
 * refleja lo que el servidor decidio.
 *
 * <p><b>La transaccion envuelve todo.</b> La emergencia y la solicitud
 * commitean juntas, para que no exista una emergencia sin despacho por una
 * escritura parcial. La excepcion es "no hay unidades": no escribe nada y el
 * adaptador la convierte en "sin solicitud", de modo que el reporte se conserva.
 * Los push van DESPUES del commit (regla de oro del contrato): el evento se
 * consume con {@code @TransactionalEventListener(AFTER_COMMIT)} en {@link
 * EmergenciaPushListener} y el de la solicitud en {@code FlotaPushListener}.
 */
@Service
public class ReportarEmergenciaUseCaseImpl implements ReportarEmergenciaUseCase {

    private final EmergenciaRepository emergenciaRepository;
    private final ZonaRepository zonaRepository;
    private final DespachoAmbulanciaPort despachoAmbulanciaPort;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final RegistroAuditoriaPort registroAuditoriaPort;

    public ReportarEmergenciaUseCaseImpl(EmergenciaRepository emergenciaRepository,
                                         ZonaRepository zonaRepository,
                                         DespachoAmbulanciaPort despachoAmbulanciaPort,
                                         ApplicationEventPublisher eventPublisher,
                                         Clock clock,
                                         RegistroAuditoriaPort registroAuditoriaPort) {
        this.emergenciaRepository = emergenciaRepository;
        this.zonaRepository = zonaRepository;
        this.despachoAmbulanciaPort = despachoAmbulanciaPort;
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

        // Sin solicitante no hay a quien entregarle el ciclo de la solicitud:
        // el reporte se registra y el despacho queda para un llamador con identidad.
        UUID solicitudId = solicitanteId == null
                ? null
                : despachoAmbulanciaPort.despachar(guardada, solicitanteId, direccion).orElse(null);

        return new EmergenciaReportada(guardada, solicitudId);
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
