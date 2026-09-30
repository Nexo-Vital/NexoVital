package co.edu.escuelaing.nexovital.mapa.domain.model;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit cases of {@link Zona#contiene(Ubicacion)}: the point-in-polygon check
 * that makes "a center belongs to the locality it declares" verifiable instead
 * of a claim. Uses a plain lat/lng square so the expectation is obvious.
 */
class ZonaTest {

    /** A 0.1° x 0.1° square around Bogotá's centre. */
    private static final List<Ubicacion> CUADRADO = List.of(
            new Ubicacion(4.70d, -74.10d),
            new Ubicacion(4.70d, -74.00d),
            new Ubicacion(4.60d, -74.00d),
            new Ubicacion(4.60d, -74.10d));

    private static Zona zonaCon(List<Ubicacion> contorno) {
        return new Zona("Z-PRUEBA", "Prueba", new Ubicacion(4.65d, -74.05d), contorno);
    }

    @Test
    @DisplayName("a point inside the contour is contained")
    void t1_unPuntoInteriorEstaContenido() {
        assertTrue(zonaCon(CUADRADO).contiene(new Ubicacion(4.65d, -74.05d)));
    }

    @Test
    @DisplayName("a point outside the contour is not contained")
    void t2_unPuntoExteriorNoEstaContenido() {
        assertFalse(zonaCon(CUADRADO).contiene(new Ubicacion(4.90d, -74.05d)));
        assertFalse(zonaCon(CUADRADO).contiene(new Ubicacion(4.65d, -73.90d)));
    }

    @Test
    @DisplayName("a contour with fewer than three vertices encloses no area")
    void t3_unContornoDeMenosDeTresVerticesNoEncierraArea() {
        assertFalse(zonaCon(List.of()).contiene(new Ubicacion(4.65d, -74.05d)));
        assertFalse(zonaCon(List.of(new Ubicacion(4.65d, -74.05d)))
                .contiene(new Ubicacion(4.65d, -74.05d)));
    }

    @Test
    @DisplayName("a null point is rejected")
    void t4_unPuntoNuloSeRechaza() {
        assertThrows(NullPointerException.class, () -> zonaCon(CUADRADO).contiene(null));
    }
}
