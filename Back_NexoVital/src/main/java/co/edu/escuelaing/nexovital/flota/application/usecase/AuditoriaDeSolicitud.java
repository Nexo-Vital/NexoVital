package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.time.Instant;
import java.util.UUID;

/**
 * Cuelga el evento de auditoría de una solicitud del recurso correcto.
 *
 * <p>Una solicitud creada a partir de una emergencia pertenece a la traza de esa
 * emergencia: la consulta del escenario es "la traza completa de una emergencia",
 * y si los eventos del conductor se guardaran contra la solicitud esa traza
 * quedaría partida en dos. Una solicitud creada directamente (sin emergencia) no
 * tiene otra traza posible, así que se registra contra sí misma con
 * {@link EventoAuditoria#TIPO_SOLICITUD}.
 *
 * <p>Se centraliza acá para que las cinco acciones del ciclo de la solicitud no
 * repitan la misma decisión: una sola regla, un solo lugar.
 */
final class AuditoriaDeSolicitud {

    private AuditoriaDeSolicitud() {
        // Clase de utilidad.
    }

    /**
     * Registra el evento en la transacción del caso de uso que lo llama.
     *
     * @param puerto    puerto de la bitácora
     * @param accion    acción crítica ejecutada
     * @param solicitud solicitud sobre la que se actuó
     * @param actorId   quién la ejecutó
     * @param detalle   texto legible que queda en la traza
     * @param cuando    instante del hecho
     */
    static void registrar(RegistroAuditoriaPort puerto,
                          AccionCritica accion,
                          SolicitudAmbulancia solicitud,
                          UUID actorId,
                          String detalle,
                          Instant cuando) {
        UUID emergenciaId = solicitud.getEmergenciaId();
        puerto.registrar(EventoAuditoria.nuevo(
                accion,
                emergenciaId != null ? EventoAuditoria.TIPO_EMERGENCIA : EventoAuditoria.TIPO_SOLICITUD,
                emergenciaId != null ? emergenciaId : solicitud.getId(),
                actorId,
                detalle,
                cuando));
    }
}
