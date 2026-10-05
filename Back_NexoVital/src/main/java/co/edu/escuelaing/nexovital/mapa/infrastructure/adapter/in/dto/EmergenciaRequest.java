package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

/**
 * Cuerpo de {@code POST /api/v1/emergencias}:
 * {@code {ubicacion: {lat, lng}, tipo, nivel, descripcion}}.
 *
 * <p>{@code tipo} es el tipo de emergencia de la historia EP-02.F1.US3, uno de
 * los valores de
 * {@link co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia}. Es un
 * campo AÑADIDO al contrato original (que solo traía nivel y descripción).
 *
 * <p>Los campos son envoltorios ({@link Double}, {@link String}) a propósito: un
 * campo ausente llega como {@code null} y el controlador lo rechaza con el
 * envelope de error, en vez de que un primitivo lo enmascare como {@code 0}.
 */
public record EmergenciaRequest(UbicacionRequest ubicacion, String tipo, String nivel, String descripcion) {

    /** Ubicación del cuerpo: {@code {lat, lng}} (contrato, schema {@code Ubicacion}). */
    public record UbicacionRequest(Double lat, Double lng) {
    }
}
