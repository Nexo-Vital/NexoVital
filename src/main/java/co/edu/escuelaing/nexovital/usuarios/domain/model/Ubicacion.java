package co.edu.escuelaing.nexovital.usuarios.domain.model;

/**
 * Coordenada geográfica simple (latitud/longitud en WGS84).
 *
 * <p>Se modela como dos {@code double} y no como geometría: el entorno local
 * usa H2 sin PostGIS, así que la ubicación es un par de números y no un tipo
 * espacial.
 */
public record Ubicacion(double lat, double lng) {

    public Ubicacion {
        if (lat < -90.0d || lat > 90.0d) {
            throw new IllegalArgumentException("lat debe estar entre -90 y 90: " + lat);
        }
        if (lng < -180.0d || lng > 180.0d) {
            throw new IllegalArgumentException("lng debe estar entre -180 y 180: " + lng);
        }
    }
}
