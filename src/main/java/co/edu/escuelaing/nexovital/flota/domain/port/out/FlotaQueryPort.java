package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Read port of the fleet. Kept separate from the write port (CQRS-lite). */
public interface FlotaQueryPort {

    List<Ambulancia> consultarFlota();

    /**
     * The unit driven by {@code conductorId}, or empty when the driver has none.
     * It backs the server-scoped read a driver uses to find its OWN unit without
     * the general list disclosing every driver's id.
     */
    Optional<Ambulancia> buscarPorConductor(UUID conductorId);
}
