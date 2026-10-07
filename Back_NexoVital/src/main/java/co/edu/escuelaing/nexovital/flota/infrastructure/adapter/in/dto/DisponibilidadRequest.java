package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

/**
 * Body of {@code POST /api/v1/flota/ambulancias/mia/disponibilidad}: the state
 * the driver declares for their own unit. {@code true} is "Disponible" and
 * {@code false} is "Fuera de servicio".
 *
 * <p>The field is a boxed {@code Boolean} on purpose: a missing value arrives as
 * {@code null} and the controller answers 400, instead of a primitive silently
 * reading it as {@code false} and taking the unit out of service.
 */
public record DisponibilidadRequest(Boolean disponible) {
}
