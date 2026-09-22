package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/**
 * La cuenta está bloqueada por intentos fallidos (diseño D7). Se traduce a
 * {@code 423 Locked} con código {@code CUENTA_BLOQUEADA} y la cabecera
 * {@code Retry-After} construida a partir de {@link #getSegundosRestantes()}.
 */
public class CuentaBloqueadaException extends RuntimeException {

    private final long segundosRestantes;

    public CuentaBloqueadaException(long segundosRestantes) {
        super(construirMensaje(segundosRestantes));
        this.segundosRestantes = segundosRestantes;
    }

    /**
     * @return segundos que faltan para que la ventana de bloqueo expire
     */
    public long getSegundosRestantes() {
        return segundosRestantes;
    }

    private static String construirMensaje(long segundosRestantes) {
        long minutos = Math.max(1L, (segundosRestantes + 59L) / 60L);
        String unidad = minutos == 1L ? " minuto." : " minutos.";
        return "Cuenta bloqueada por intentos fallidos. Reintente en " + minutos + unidad;
    }
}
