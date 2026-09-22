package co.edu.escuelaing.nexovital.shared.infrastructure.dto;

/**
 * Envelope de error uniforme de la API: {@code {codigo, mensaje}}.
 */
public record ErrorResponse(String codigo, String mensaje) {

    public static ErrorResponse of(String codigo, String mensaje) {
        return new ErrorResponse(codigo, mensaje);
    }
}
