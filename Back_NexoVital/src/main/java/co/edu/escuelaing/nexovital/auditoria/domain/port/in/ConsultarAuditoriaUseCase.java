package co.edu.escuelaing.nexovital.auditoria.domain.port.in;

import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;

import java.util.List;
import java.util.UUID;

/**
 * Consulta de la bitácora. Las dos vistas que pide el escenario: la traza de una
 * emergencia y la de un centro de acopio.
 */
public interface ConsultarAuditoriaUseCase {

    List<EventoAuditoria> porEmergencia(UUID emergenciaId);

    List<EventoAuditoria> porCentro(UUID centroId);
}
