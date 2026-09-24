package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

/**
 * Cuerpo de {@code POST /api/v1/emergencias} (contrato OpenAPI):
 * {@code {ubicacion: {lat, lng}, nivel, descripcion}}.
 *
 * <p>Los campos son envoltorios ({@link Double}, {@link String}) a propósito: un
 * campo ausente llega como {@code null} y el controlador lo rechaza con el
 * envelope de error, en vez de que un primitivo lo enmascare como {@code 0}.
 */
public record EmergenciaRequest(UbicacionRequest ubicacion, String nivel, String descripcion) {

    /** Ubicación del cuerpo: {@code {lat, lng}} (contrato, schema {@code Ubicacion}). */
    public record UbicacionRequest(Double lat, Double lng) {
    }
}
