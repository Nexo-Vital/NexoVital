package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Adaptador de persistencia de la bitácora.
 *
 * <p>Resuelve el rol del actor desde el contexto de seguridad: el caso de uso
 * conoce el id del llamante (lo recibe como parámetro) pero no su rol, y
 * arrastrar el {@code Authentication} hasta el dominio sería peor. Se guarda el
 * rol del momento de la acción, no el actual: la bitácora cuenta lo que era
 * cierto cuando ocurrió.
 */
@Component
public class RegistroAuditoriaAdapter implements RegistroAuditoriaPort {

    private final EventoAuditoriaJpaRepository repositorio;

    public RegistroAuditoriaAdapter(EventoAuditoriaJpaRepository repositorio) {
        this.repositorio = repositorio;
    }

    @Override
    public void registrar(EventoAuditoria evento) {
        repositorio.save(new EventoAuditoriaJpaEntity(
                evento.id(),
                evento.actorId(),
                evento.actorRol() != null ? evento.actorRol() : rolActual(),
                evento.accion(),
                evento.recursoTipo(),
                evento.recursoId(),
                evento.detalle(),
                evento.ocurridoEn()));
    }

    @Override
    public List<EventoAuditoria> porRecurso(String recursoTipo, UUID recursoId) {
        return repositorio
                .findByRecursoTipoAndRecursoIdOrderByOcurridoEnAsc(recursoTipo, recursoId)
                .stream()
                .map(RegistroAuditoriaAdapter::aDominio)
                .toList();
    }

    private static EventoAuditoria aDominio(EventoAuditoriaJpaEntity entidad) {
        return new EventoAuditoria(
                entidad.getId(),
                entidad.getActorId(),
                entidad.getActorRol(),
                entidad.getAccion(),
                entidad.getRecursoTipo(),
                entidad.getRecursoId(),
                entidad.getDetalle(),
                entidad.getOcurridoEn());
    }

    /** Rol del llamante, o {@code null} si el evento no nace de una petición. */
    private static String rolActual() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        if (authentication.getPrincipal() instanceof Usuario usuario) {
            return usuario.getRol().name();
        }
        return authentication.getAuthorities().stream()
                .findFirst()
                .map(authority -> authority.getAuthority().replaceFirst("^ROLE_", ""))
                .orElse(null);
    }
}
