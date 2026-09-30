package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.EstadoIntentos;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Puerto de salida del estado de intentos fallidos (diseño D4).
 *
 * <p>Contrato de atomicidad (diseño D6): {@link #registrarFallo} resuelve el
 * incremento del contador y el disparo del bloqueo en <b>una sola sentencia</b>
 * de actualización condicional, nunca con lectura-modificación-escritura en
 * Java.
 */
public interface EstadoIntentosPort {

    /**
     * @return estado persistido de la cuenta, o vacío si la cuenta no existe
     */
    Optional<EstadoIntentos> buscar(UUID usuarioId);

    /**
     * Incrementa el contador de fallos y, si alcanza {@code maxIntentos}, fija
     * {@code bloqueadoHasta = limite}. Ambas cosas ocurren en una única
     * sentencia SQL atómica.
     *
     * @param limite      instante hasta el cual bloquear la cuenta si se alcanza el máximo
     * @param maxIntentos fallos consecutivos que disparan el bloqueo
     * @return estado resultante, leído después del incremento
     */
    EstadoIntentos registrarFallo(UUID usuarioId, Instant limite, int maxIntentos);

    /**
     * Deja la cuenta con contador en cero y sin bloqueo. Se usa en el login
     * exitoso y cuando una ventana de bloqueo ya expiró (diseño D5).
     */
    void reiniciar(UUID usuarioId);
}
