package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.PlacaDuplicadaException;

import java.util.UUID;

/**
 * Crea el vehículo de un conductor recién registrado. Lo implementa el módulo
 * {@code flota}, que es el dueño de las ambulancias.
 */
public interface UnidadConductorPort {

    /**
     * @throws PlacaDuplicadaException si ya existe un vehículo con esa placa
     */
    void registrarUnidad(UUID conductorId, String placa, String modelo);
}
