package co.edu.escuelaing.nexovital.auditoria.application.usecase;

import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.port.in.ConsultarAuditoriaUseCase;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Las dos lecturas de la bitácora. No hay lógica de negocio que aplicar: la
 * consulta es por recurso y siempre en orden cronológico, porque una traza que
 * no se lee en orden no cuenta una historia.
 */
@Service
@Transactional(readOnly = true)
public class ConsultarAuditoriaUseCaseImpl implements ConsultarAuditoriaUseCase {

    private final RegistroAuditoriaPort registroAuditoriaPort;

    public ConsultarAuditoriaUseCaseImpl(RegistroAuditoriaPort registroAuditoriaPort) {
        this.registroAuditoriaPort = registroAuditoriaPort;
    }

    @Override
    public List<EventoAuditoria> porEmergencia(UUID emergenciaId) {
        return registroAuditoriaPort.porRecurso(EventoAuditoria.TIPO_EMERGENCIA, emergenciaId);
    }

    @Override
    public List<EventoAuditoria> porCentro(UUID centroId) {
        return registroAuditoriaPort.porRecurso(EventoAuditoria.TIPO_CENTRO, centroId);
    }

    @Override
    public List<EventoAuditoria> porSolicitud(UUID solicitudId) {
        return registroAuditoriaPort.porRecurso(EventoAuditoria.TIPO_SOLICITUD, solicitudId);
    }
}
