package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.List;

/** Read port of the fleet. Kept separate from the write port (CQRS-lite). */
public interface FlotaQueryPort {

    List<Ambulancia> consultarFlota();
}
