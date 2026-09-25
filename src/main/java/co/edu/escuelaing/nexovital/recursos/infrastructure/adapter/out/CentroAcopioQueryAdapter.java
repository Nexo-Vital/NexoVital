package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.recursos.domain.port.out.CentroAcopioQueryPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Satisface {@link CentroAcopioQueryPort} delegando en el caso de uso público de
 * {@code usuarios}. Es el único punto de {@code recursos} que conoce el módulo
 * dueño del centro: la frontera de datos se respeta porque NO hay {@code SELECT}
 * a su esquema, solo una llamada a su puerto de entrada (ADR-0003).
 *
 * <p>No filtra por tipo: el contrato de inventario identifica al centro por id y
 * la existencia de una organización con ese id es la condición que fija el
 * 404; restringir a {@code CENTRO_ACOPIO} inventaría una regla que el contrato
 * no declara.
 */
@Component
public class CentroAcopioQueryAdapter implements CentroAcopioQueryPort {

    private final ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    public CentroAcopioQueryAdapter(ListarOrganizacionesUseCase listarOrganizacionesUseCase) {
        this.listarOrganizacionesUseCase = listarOrganizacionesUseCase;
    }

    @Override
    public boolean existe(UUID centroAcopioId) {
        return listarOrganizacionesUseCase.listar(null).stream()
                .anyMatch(organizacion -> organizacion.getId().equals(centroAcopioId));
    }
}
