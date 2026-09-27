package co.edu.escuelaing.nexovital.flota.domain.model;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * State machine of the fleet unit. Framework-free: only a unit that is
 * {@code EN_MISION} can be released (EP-04.F2.US11).
 */
class AmbulanciaTest {

    private final UUID id = UUID.randomUUID();
    private final UUID conductorId = UUID.randomUUID();

    private Ambulancia disponible() {
        return new Ambulancia(id, "ABC101", EstadoAmbulancia.DISPONIBLE,
                4.73d, -74.08d, "Suba", conductorId, 0);
    }

    @Test
    void marcarEnMisionSoloDesdeDisponible() {
        Ambulancia enMision = disponible().marcarEnMision();
        assertEquals(EstadoAmbulancia.EN_MISION, enMision.getEstado());
        assertThrows(IllegalStateException.class, enMision::marcarEnMision);
    }

    @Test
    void liberarSoloDesdeEnMision() {
        Ambulancia liberada = disponible().marcarEnMision().liberar();
        assertEquals(EstadoAmbulancia.DISPONIBLE, liberada.getEstado());
        assertThrows(IllegalStateException.class, () -> disponible().liberar());
    }
}
