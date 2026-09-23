package co.edu.escuelaing.nexovital.usuarios.domain.port.in;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;

import java.util.List;

/**
 * Puerto de entrada: listar organizaciones. Una intención por caso de uso; la
 * creación, cuando se cubra, será otro caso de uso.
 */
public interface ListarOrganizacionesUseCase {

    /**
     * @param tipo filtro opcional por tipo de organización; {@code null} lista
     *             todas
     * @return las organizaciones, ordenadas por nombre
     */
    List<Organizacion> listar(TipoOrganizacion tipo);
}
