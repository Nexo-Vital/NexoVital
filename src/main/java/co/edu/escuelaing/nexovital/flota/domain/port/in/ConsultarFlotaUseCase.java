package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.List;

/** Read model of the fleet with position and state (AC5). */
public interface ConsultarFlotaUseCase {

    List<Ambulancia> consultarFlota();
}
