package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto;

/**
 * Cuerpo de {@code POST /api/v1/organizaciones} (contrato OpenAPI):
 * {@code {nombre, tipo, ubicacion, zonaId}}.
 *
 * <p>Los campos son envoltorios ({@link String}, {@link Double}) a propósito: un
 * campo ausente llega como {@code null} y el controlador lo rechaza con el
 * envelope de error, en vez de que un primitivo lo enmascare como {@code 0}.
 * Mismo criterio que el {@code EmergenciaRequest} de {@code mapa}: los dos son
 * cuerpos HTTP con campos opcionales.
 *
 * <p>{@code zonaId} es opcional (decisión D2 de la tarea): un centro puede
 * quedar sin zona asignada.
 */
public record OrganizacionRequest(String nombre, String tipo, UbicacionRequest ubicacion, String zonaId) {

    /** Ubicación del cuerpo: {@code {lat, lng}} (contrato, schema {@code Ubicacion}). */
    public record UbicacionRequest(Double lat, Double lng) {
    }
}
