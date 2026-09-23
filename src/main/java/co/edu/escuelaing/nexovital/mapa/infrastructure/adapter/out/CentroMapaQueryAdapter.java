package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.mapa.domain.port.out.CentroMapaQueryPort;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Satisface {@link CentroMapaQueryPort} delegando en el caso de uso público de
 * {@code usuarios}. Es el único punto de {@code mapa} que conoce el módulo
 * dueño: la frontera de datos se respeta porque no hay acceso a su tabla, solo
 * a su puerto de entrada.
 *
 * <p>No filtra por tipo: el mapa publica todos los centros con su ubicación
 * (hoy la semilla es toda de centros de acopio). "Activo" no tiene
 * representación en el modelo actual — no hay marca de baja — así que todos
 * los centros persistidos se consideran activos. No se finge un estado que no
 * existe.
 */
@Component
public class CentroMapaQueryAdapter implements CentroMapaQueryPort {

    private final ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    public CentroMapaQueryAdapter(ListarOrganizacionesUseCase listarOrganizacionesUseCase) {
        this.listarOrganizacionesUseCase = listarOrganizacionesUseCase;
    }

    @Override
    public List<Organizacion> listarCentros() {
        return listarOrganizacionesUseCase.listar(null);
    }
}
