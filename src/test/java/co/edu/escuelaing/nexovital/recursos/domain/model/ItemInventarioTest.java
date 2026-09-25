package co.edu.escuelaing.nexovital.recursos.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Reglas puras de {@link ItemInventario}: el semáforo 30 % / 80 % con
 * aritmética entera. Sin Spring ni base de datos: es la regla la que se fija
 * aquí, para que los bordes exactos no dependan de datos sembrados.
 *
 * <p>La regla del dominio (Javadoc de {@code ItemInventario}) es:
 * {@code < 30 %} ROJO, {@code >= 30 % y < 80 %} AMARILLO, {@code >= 80 %} VERDE.
 * Exactamente 80 % es VERDE (el front usa {@code > 0.8}; ese borde se reporta,
 * no se cambia acá).
 */
class ItemInventarioTest {

    private static final UUID ITEM_ID = UUID.randomUUID();
    private static final UUID CENTRO_ID = UUID.randomUUID();

    private static ItemInventario item(int disponible, int requerido) {
        return new ItemInventario(ITEM_ID, CENTRO_ID, "Insumo", disponible, requerido, null, null);
    }

    @Test
    @DisplayName("Boundary < 30%: 29/100 is ROJO, exactly 30/100 is already AMARILLO")
    void t1_bordeInferiorDelTreinta() {
        assertEquals(Semaforo.ROJO, item(29, 100).semaforo(),
                "29/100 = 29% is below the 30% floor");
        assertEquals(Semaforo.AMARILLO, item(30, 100).semaforo(),
                "30/100 = 30% is exactly the floor: AMARILLO");
    }

    @Test
    @DisplayName("Boundary >= 80%: 79/100 is AMARILLO, exactly 80/100 is VERDE")
    void t2_bordeSuperiorDelOchenta() {
        assertEquals(Semaforo.AMARILLO, item(79, 100).semaforo(),
                "79/100 = 79% is still below the 80% ceiling");
        assertEquals(Semaforo.VERDE, item(80, 100).semaforo(),
                "80/100 = 80% IS stable per the domain: VERDE");
    }

    @Test
    @DisplayName("requerido == 0 has no declared requirement: VERDE")
    void t3_sinRequerimientoEsVerde() {
        assertEquals(Semaforo.VERDE, item(0, 0).semaforo(),
                "a center that declared no requirement has no shortage to signal");
    }

    @Test
    @DisplayName("A center inherits the WORST level of its items")
    void t4_elPeorNivelGana() {
        assertEquals(Semaforo.ROJO, Semaforo.VERDE.masGrave(Semaforo.ROJO));
        assertEquals(Semaforo.ROJO, Semaforo.ROJO.masGrave(Semaforo.VERDE));
        assertEquals(Semaforo.AMARILLO, Semaforo.VERDE.masGrave(Semaforo.AMARILLO));
    }
}
