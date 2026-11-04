package co.edu.escuelaing.nexovital.observabilidad.infrastructure;

import org.slf4j.MDC;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Identificador de correlación de una petición (ESC-7, logs estructurados).
 *
 * <p>Vive en el MDC de SLF4J con la clave {@value #CLAVE_MDC}: el patrón de
 * consola de desarrollo y el formato JSON de docker/prod lo incluyen en cada
 * línea, así que todas las líneas de una misma petición se pueden agrupar sin
 * adivinar por timestamp.
 *
 * <p><b>Por qué se valida la cabecera entrante.</b> {@value #CABECERA} la manda
 * el cliente, y un cliente puede mandar cualquier cosa: un salto de línea
 * inyecta líneas falsas en el log y un valor de megabytes infla cada línea. Un
 * patrón corto y acotado (letras, dígitos, punto, guion y guion bajo, entre 8 y
 * 64 caracteres) deja pasar los ids razonables —UUID, W3C traceparent recortado,
 * ids de un gateway— y descarta el resto, que se reemplaza por uno generado
 * aquí.
 *
 * <p>No se usa la cabecera {@code traceparent} de W3C porque el backend no
 * participa de una malla de trazas; esto es correlación de logs, no tracing
 * distribuido.
 */
public final class TraceId {

    /** Cabecera de entrada y de salida con el identificador de la petición. */
    public static final String CABECERA = "X-Request-Id";

    /** Clave del MDC que el patrón de log y el formato JSON imprimen. */
    public static final String CLAVE_MDC = "traceId";

    /**
     * Un id aceptable: 8 a 64 caracteres de {@code [A-Za-z0-9._-]}. Deliberadamente
     * sin espacios, sin saltos de línea y sin caracteres de control.
     */
    private static final Pattern ACEPTABLE = Pattern.compile("[A-Za-z0-9._-]{8,64}");

    private TraceId() {
        // Clase de utilidad.
    }

    /** Genera un identificador nuevo (UUID v4). */
    public static String nuevo() {
        return UUID.randomUUID().toString();
    }

    /**
     * Devuelve {@code candidato} si es aceptable y, si no lo es, un id nuevo.
     *
     * <p>Nunca devuelve {@code null} ni una cadena vacía.
     */
    public static String aceptado(String candidato) {
        if (candidato != null && ACEPTABLE.matcher(candidato).matches()) {
            return candidato;
        }
        return nuevo();
    }

    /** Identificador de la petición en curso, o {@code null} fuera de una. */
    public static String actual() {
        return MDC.get(CLAVE_MDC);
    }

    /** Publica el identificador en el MDC del hilo actual. */
    public static void poner(String id) {
        MDC.put(CLAVE_MDC, id);
    }

    /** Quita el identificador del MDC del hilo actual. */
    public static void limpiar() {
        MDC.remove(CLAVE_MDC);
    }
}
