package co.edu.escuelaing.nexovital.infrastructure.bloqueo;

import java.time.Duration;

/**
 * Garantiza que una tarea programada corra en una sola instancia a la vez.
 *
 * <p>Con dos instancias detrás del balanceador, todo proceso programado se
 * ejecutaría en ambas. La tarea T05 del Sprint 2 pide una sola ejecución entre
 * instancias, así que todos los barridos toman el bloqueo antes de correr. Los
 * barridos condicionales (expirar solicitudes, marcar señal perdida, confirmar
 * llegadas) seguirían siendo idempotentes sin él; el bloqueo hace explícita la
 * garantía. El simulador de flota además lo necesita: sin bloqueo, dos
 * instancias moverían cada ambulancia dos veces por ciclo y emitirían el evento
 * duplicado.
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
