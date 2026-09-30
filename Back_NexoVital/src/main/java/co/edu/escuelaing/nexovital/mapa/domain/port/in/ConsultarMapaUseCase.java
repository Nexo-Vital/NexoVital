package co.edu.escuelaing.nexovital.mapa.domain.port.in;

import co.edu.escuelaing.nexovital.mapa.domain.model.Mapa;

/**
 * Puerto de entrada: consultar el mapa. Una intención por caso de uso.
 */
public interface ConsultarMapaUseCase {

    /**
     * @return las zonas y los centros con su ubicación
     */
    Mapa consultar();
}
