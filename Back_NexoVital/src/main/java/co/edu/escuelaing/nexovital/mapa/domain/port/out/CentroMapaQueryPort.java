package co.edu.escuelaing.nexovital.mapa.domain.port.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;

import java.util.List;

/**
 * Puerto de salida hacia el módulo {@code usuarios}: el mapa lee los centros
 * por este puerto y nunca por un {@code SELECT} a su esquema (frontera de
 * datos, ADR-0003 / system-design §2.1).
 *
 * <p>Lo satisface un adaptador de {@code mapa} que delega en el caso de uso
 * público de {@code usuarios} ({@code ListarOrganizacionesUseCase}), no en su
 * repositorio: el diseño manda leer por el puerto del módulo dueño.
 *
 * <p>Se reutiliza el agregado {@link Organizacion} que el módulo dueño publica
 * en lugar de copiar su forma campo por campo; el mapa no accede a su tabla.
 */
public interface CentroMapaQueryPort {

    /**
     * @return los centros con su ubicación
     */
    List<Organizacion> listarCentros();
}
