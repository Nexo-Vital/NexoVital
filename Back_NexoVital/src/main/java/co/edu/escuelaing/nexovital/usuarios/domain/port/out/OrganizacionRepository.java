package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;

import java.util.List;

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
}
