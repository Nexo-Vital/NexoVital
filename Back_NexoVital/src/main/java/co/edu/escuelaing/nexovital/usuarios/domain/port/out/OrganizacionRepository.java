package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;

import java.util.List;
import java.util.UUID;
import java.util.Optional;

/**
 * Puerto de salida de persistencia de organizaciones. Devuelve el agregado de
 * dominio {@link Organizacion}, nunca la entidad JPA.
 */
public interface OrganizacionRepository {

    /**
     * @param tipo filtro opcional; {@code null} lista todas
     */
    List<Organizacion> listar(TipoOrganizacion tipo);

    boolean existePorNombre(String nombre);

    Organizacion guardar(Organizacion organizacion);

    /**
     * @param adminId id del usuario administrador
     * @return el centro que administra ese usuario, o vacío si no tiene
     */
    Optional<Organizacion> buscarPorAdmin(UUID adminId);
}
