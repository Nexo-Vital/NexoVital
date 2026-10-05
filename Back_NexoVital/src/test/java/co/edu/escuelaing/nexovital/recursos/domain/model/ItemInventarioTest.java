package co.edu.escuelaing.nexovital.recursos.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Reglas puras de {@link ItemInventario}: el semáforo 35 % / 70 % / 100 % con
 * aritmética entera (EP-02.F2.US1). Sin Spring ni base de datos: es la regla la
 * que se fija aquí, para que los bordes exactos no dependan de datos sembrados.
 *
 * <p>{@code < 35 %} ROJO, {@code >= 35 % y < 70 %} AMARILLO,
 * {@code >= 70 % y < 100 %} VERDE, {@code >= 100 %} (o sin requerimiento)
 * COMPLETO.
 */
class ItemInventarioTest {

    private static final UUID ITEM_ID = UUID.randomUUID();
    private static final UUID CENTRO_ID = UUID.randomUUID();

    private static ItemInventario item(int disponible, int requerido) {
        return new ItemInventario(ITEM_ID, CENTRO_ID, "Insumo", disponible, requerido, null, null);
    }

    @Test
    @DisplayName("Boundary 35%: 34/100 is ROJO, exactly 35/100 is already AMARILLO")
    void t1_bordeInferiorDelTreintaYCinco() {
        assertEquals(Semaforo.ROJO, item(34, 100).semaforo());
        assertEquals(Semaforo.AMARILLO, item(35, 100).semaforo());
    }

    @Test
    @DisplayName("Boundary 70%: 69/100 is AMARILLO, exactly 70/100 is VERDE")
    void t2_bordeDelSetenta() {
        assertEquals(Semaforo.AMARILLO, item(69, 100).semaforo());
        assertEquals(Semaforo.VERDE, item(70, 100).semaforo());
    }

    @Test
    @DisplayName("Boundary 100%: 99/100 is VERDE, 100/100 and surplus are COMPLETO")
    void t3_bordeDelCien() {
        assertEquals(Semaforo.VERDE, item(99, 100).semaforo());
        assertEquals(Semaforo.COMPLETO, item(100, 100).semaforo());
        assertEquals(Semaforo.COMPLETO, item(150, 100).semaforo());
    }

    @Test
    @DisplayName("requerido == 0 has no declared requirement: COMPLETO")
    void t4_sinRequerimientoEsCompleto() {
        assertEquals(Semaforo.COMPLETO, item(0, 0).semaforo());
        assertEquals(Semaforo.COMPLETO, item(44, 0).semaforo());
    }

    @Test
    @DisplayName("A center inherits the WORST level of its items")
    void t5_elPeorNivelGana() {
        assertEquals(Semaforo.ROJO, Semaforo.VERDE.masGrave(Semaforo.ROJO));
        assertEquals(Semaforo.ROJO, Semaforo.ROJO.masGrave(Semaforo.VERDE));
        assertEquals(Semaforo.AMARILLO, Semaforo.VERDE.masGrave(Semaforo.AMARILLO));
        assertEquals(Semaforo.VERDE, Semaforo.COMPLETO.masGrave(Semaforo.VERDE));
        assertEquals(Semaforo.VERDE, Semaforo.VERDE.masGrave(Semaforo.COMPLETO));
    }
}
