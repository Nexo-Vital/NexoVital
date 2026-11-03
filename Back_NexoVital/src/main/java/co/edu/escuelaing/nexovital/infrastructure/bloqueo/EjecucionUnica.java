package co.edu.escuelaing.nexovital.infrastructure.bloqueo;

import java.time.Duration;

/**
 * Garantiza que una tarea no idempotente corra en una sola instancia a la vez.
 *
 * <p>Con dos instancias detrás del balanceador, todo proceso programado se
 * ejecuta en ambas. Los barridos que hacen actualizaciones condicionales
 * (expirar solicitudes, marcar señal perdida, confirmar llegadas) son
 * idempotentes y no necesitan esto. Los que <b>generan</b> datos —el simulador
 * de flota— sí: dos instancias mueven cada ambulancia dos veces por ciclo y
 * emiten el evento duplicado.
 *
 * <p>La vigencia es deliberadamente corta: si la instancia que tiene el bloqueo
 * muere, la otra lo toma en el siguiente ciclo en lugar de quedarse esperando.
 */
@FunctionalInterface
public interface EjecucionUnica {

    /**
     * Intenta tomar (o renovar) el bloqueo de {@code nombre}.
     *
     * @param nombre   nombre estable de la tarea
     * @param vigencia cuánto vale el bloqueo si el dueño deja de renovarlo
     * @return {@code true} solo si esta instancia puede ejecutar la tarea ahora
     */
    boolean intentar(String nombre, Duration vigencia);
}
