package co.edu.escuelaing.nexovital.limites.domain.model;

/**
 * Resultado de evaluar el límite para una solicitud.
 *
 * @param permitido               si la solicitud puede seguir
 * @param segundosParaReintentar  cuánto falta para que la ventana se reinicie;
 *                                {@code 0} cuando la solicitud se permite
 */
public record VeredictoLimite(boolean permitido, long segundosParaReintentar) {

    /** La solicitud entra: el contador todavía no llegó al techo. */
    public static VeredictoLimite pasa() {
        return new VeredictoLimite(true, 0);
    }

    /** La solicitud se rechaza con 429 y se le dice cuándo reintentar. */
    public static VeredictoLimite rechazado(long segundosParaReintentar) {
        return new VeredictoLimite(false, Math.max(1, segundosParaReintentar));
    }
}
