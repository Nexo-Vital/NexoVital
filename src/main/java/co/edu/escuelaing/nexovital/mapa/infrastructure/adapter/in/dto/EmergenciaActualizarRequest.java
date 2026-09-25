package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

/**
 * Cuerpo de {@code PATCH /api/v1/emergencias/{id}} (contrato OpenAPI,
 * {@code updateEmergencia}): {@code {estado?, nivel?}}, ambos opcionales.
 *
 * <p>Los dos campos son {@link String} nullable a propósito (mismo estilo que
 * {@link EmergenciaRequest}): un campo ausente llega como {@code null} —el
 * caso de uso lo interpreta como "no cambies este campo"— y un valor fuera del
 * contrato se puede rechazar con el envelope {@code 400}, en vez de que Spring
 * falle al deserializar un enum y devuelva un error propio.
 */
public record EmergenciaActualizarRequest(String estado, String nivel) {
}
