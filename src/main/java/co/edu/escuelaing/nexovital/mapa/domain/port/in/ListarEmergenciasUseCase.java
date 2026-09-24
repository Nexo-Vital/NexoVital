package co.edu.escuelaing.nexovital.mapa.domain.port.in;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;

import java.util.List;

/**
 * Puerto de entrada: listar las emergencias reportadas. Una intención por caso
 * de uso.
 *
 * <p>El consumidor es la lectura REST del registro (decisión D7 del diseño): un
 * cliente que se conecta tarde ve el estado vigente sin depender del push
 * realtime, que no reenvía lo ya ocurrido.
 */
public interface ListarEmergenciasUseCase {

    /**
     * @return las emergencias registradas, de la más reciente a la más antigua
     */
    List<Emergencia> listar();
}
