package co.edu.escuelaing.nexovital.auditoria.domain.port.out;

import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;

import java.util.List;
import java.util.UUID;

/**
 * Puerto de salida del registro de auditoría.
 *
 * <p>Declara únicamente lo que la bitácora necesita: agregar y leer. No existe
 * {@code actualizar} ni {@code eliminar}, ni en el puerto ni en el repositorio:
 * un registro que se puede editar no es una bitácora, es un comentario.
 */
public interface RegistroAuditoriaPort {

    /** Persiste un evento. Se llama dentro de la transacción del caso de uso. */
    void registrar(EventoAuditoria evento);

    /** Traza completa de un recurso, del más viejo al más nuevo. */
    List<EventoAuditoria> porRecurso(String recursoTipo, UUID recursoId);
}
