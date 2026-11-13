package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto;

/**
 * Cuerpo de {@code POST /api/v1/emergencias}:
 * {@code {ubicacion: {lat, lng}, tipo, nivel, descripcion, direccion?}}.
 *
 * <p>{@code tipo} es el tipo de emergencia de la historia EP-02.F1.US3, uno de
 * los valores de
 * {@link co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia}. Es un
 * campo ANADIDO al contrato original (que solo traia nivel y descripcion).
 *
 * <p>{@code direccion} es ADICIONAL y opcional: la direccion legible del punto,
 * que viaja a la solicitud que el backend crea al reportar. Sin ella la
 * solicitud viaja con el punto y sin texto.
 *
 * <p>Los campos son envoltorios ({@link Double}, {@link String}) a proposito: un
 * campo ausente llega como {@code null} y el controlador lo rechaza con el
 * envelope de error, en vez de que un primitivo lo enmascare como {@code 0}.
 */
public record EmergenciaRequest(UbicacionRequest ubicacion, String tipo, String nivel, String descripcion,
                                String direccion) {

    /** Ubicacion del cuerpo: {@code {lat, lng}} (contrato, schema {@code Ubicacion}). */
    public record UbicacionRequest(Double lat, Double lng) {
    }
}
