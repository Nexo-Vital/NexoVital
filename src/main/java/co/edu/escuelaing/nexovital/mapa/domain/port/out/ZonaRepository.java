package co.edu.escuelaing.nexovital.mapa.domain.port.out;

import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;

import java.util.List;

/**
 * Puerto de salida de persistencia de zonas (tabla privada del módulo
 * {@code mapa}). Devuelve el agregado de dominio {@link Zona}, nunca la
 * entidad JPA.
 */
public interface ZonaRepository {

    List<Zona> listar();

    boolean existePorId(String id);

    Zona guardar(Zona zona);
}
