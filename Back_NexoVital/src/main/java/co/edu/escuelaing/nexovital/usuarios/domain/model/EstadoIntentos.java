package co.edu.escuelaing.nexovital.usuarios.domain.model;

import java.time.Instant;

/**
 * Estado de intentos fallidos de una cuenta (diseño D4). Vive fuera del
 * agregado {@link Usuario} porque describe intentos de autenticación, no
 * identidad.
 *
 * @param intentosFallidos fallos consecutivos desde el último éxito o desde la
 *                         última expiración de una ventana de bloqueo
 * @param bloqueadoHasta    instante absoluto hasta el cual se rechaza el login.
 *                         {@code null} o pasado significa sin bloqueo activo.
 */
public record EstadoIntentos(int intentosFallidos, Instant bloqueadoHasta) {

    /**
     * Cuenta sin historial de fallos.
     */
    public static EstadoIntentos inicial() {
        return new EstadoIntentos(0, null);
    }

    /**
     * @return {@code true} si hay una ventana de bloqueo vigente en {@code ahora}
     */
    public boolean bloqueadoEn(Instant ahora) {
        return bloqueadoHasta != null && bloqueadoHasta.isAfter(ahora);
    }

    /**
     * @return {@code true} si la cuenta fue bloqueada alguna vez y esa ventana ya expiró
     */
    public boolean bloqueoExpiradoEn(Instant ahora) {
        return bloqueadoHasta != null && !bloqueadoHasta.isAfter(ahora);
    }
}
