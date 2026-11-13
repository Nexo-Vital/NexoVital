package co.edu.escuelaing.nexovital.limites.domain.port.out;

import java.time.Duration;
import java.time.Instant;

/**
 * Contador de solicitudes por clave y ventana.
 *
 * <p>La operación es "incrementar y decir en cuánto quedó", no "leer y después
 * escribir": con dos instancias, una lectura seguida de una escritura deja pasar
 * solicitudes de más.
 */
public interface ContadorSolicitudesPort {

    /**
     * Incrementa el contador de {@code clave} dentro de la ventana vigente.
     *
     * @return el valor del contador después del incremento
     */
    long registrar(String clave, Instant ahora, Duration ventana);
}
