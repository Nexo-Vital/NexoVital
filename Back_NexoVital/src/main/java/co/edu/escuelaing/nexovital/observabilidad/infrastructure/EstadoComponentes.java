package co.edu.escuelaing.nexovital.observabilidad.infrastructure;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Estado de los componentes de los que depende cada instancia (Sprint 2, T38).
 *
 * <p>El escenario O-1 pide que «el estado de cada componente sea visible en todo
 * momento». Prometheus ya sabe si cada backend responde ({@code up}); lo que no
 * sabe es si ese backend llega a la base de datos y a RabbitMQ. Esta clase lo
 * comprueba y lo publica como el gauge {@value #METRICA}, con la etiqueta
 * {@code componente} ({@code base_datos} o {@code rabbitmq}): 1 si responde, 0 si
 * no. Así el tablero técnico muestra los tres componentes sin agregar
 * exportadores nuevos al despliegue.
 *
 * <p><b>Por qué con hilos propios y un tiempo límite.</b> Si la base de datos se
 * cae, pedir una conexión al pool puede bloquear hasta 30 s, y el escenario pide
 * ver la degradación en 30 s o menos. Cada comprobación corre en un hilo aparte
 * y, si no contesta en {@value #TIEMPO_LIMITE_MS} ms, el componente se marca como
 * caído sin esperar más. Tampoco usa el planificador compartido de
 * {@code @Scheduled}, para no retrasar las tareas de negocio (vencimiento de
 * solicitudes, simulación de flota) si una comprobación se queda colgada.
 *
 * <p>Mientras no haya una primera comprobación el gauge vale {@code NaN}, para
 * que el tablero muestre «sin datos» y no un estado inventado.
 */
@Component
public class EstadoComponentes implements DisposableBean {

    private static final Logger LOG = LoggerFactory.getLogger(EstadoComponentes.class);

    static final String METRICA = "nexovital.componente.disponible";
    static final String BASE_DATOS = "base_datos";
    static final String RABBITMQ = "rabbitmq";
    static final long TIEMPO_LIMITE_MS = 2000;

    private static final long SIN_DATOS = -1;

    private final long intervaloMs;
    private final Map<String, Comprobacion> comprobaciones = new LinkedHashMap<>();
    private final ExecutorService verificadores = Executors.newFixedThreadPool(2, hilos("estado-componentes"));
    private final ScheduledExecutorService reloj =
            Executors.newSingleThreadScheduledExecutor(hilos("estado-componentes-reloj"));

    public EstadoComponentes(
            MeterRegistry registro,
            JdbcTemplate jdbcTemplate,
            ObjectProvider<RabbitTemplate> rabbitTemplate,
            @Value("${nexovital.eventos.broker.enabled:false}") boolean brokerHabilitado,
            @Value("${nexovital.metricas.componentes.intervalo-ms:5000}") long intervaloMs) {
        this.intervaloMs = intervaloMs;
        agregar(registro, BASE_DATOS,
                () -> Integer.valueOf(1).equals(jdbcTemplate.queryForObject("SELECT 1", Integer.class)));
        // Sin broker (desarrollo y tests) no hay RabbitMQ que vigilar: no se
        // publica la serie, en vez de reportarlo caído.
        if (brokerHabilitado) {
            agregar(registro, RABBITMQ, () -> {
                RabbitTemplate template = rabbitTemplate.getIfAvailable();
                return template != null && Boolean.TRUE.equals(template.execute(canal -> canal.isOpen()));
            });
        }
    }

    /** Arranca la verificación periódica cuando la aplicación ya está lista. */
    @EventListener(ApplicationReadyEvent.class)
    public void iniciar() {
        reloj.scheduleWithFixedDelay(this::verificarAhora, 0, intervaloMs, TimeUnit.MILLISECONDS);
    }

    /** Comprueba todos los componentes una vez. Público para las pruebas. */
    public void verificarAhora() {
        for (Comprobacion comprobacion : comprobaciones.values()) {
            try {
                comprobacion.verificar();
            } catch (RuntimeException e) {
                // Una excepción aquí cancelaría la tarea periódica para siempre.
                comprobacion.marcar(false, e.getClass().getSimpleName());
            }
        }
    }

    /** Último estado conocido: 1 disponible, 0 caído, NaN si aún no se comprobó. */
    public double estado(String componente) {
        Comprobacion comprobacion = comprobaciones.get(componente);
        return comprobacion == null ? Double.NaN : comprobacion.valor();
    }

    @Override
    public void destroy() {
        reloj.shutdownNow();
        verificadores.shutdownNow();
    }

    private void agregar(MeterRegistry registro, String nombre, BooleanSupplier prueba) {
        Comprobacion comprobacion = new Comprobacion(nombre, prueba);
        comprobaciones.put(nombre, comprobacion);
        Gauge.builder(METRICA, comprobacion, Comprobacion::valor)
                .description("1 si la instancia llega al componente, 0 si no responde")
                .tag("componente", nombre)
                .register(registro);
    }

    private static ThreadFactory hilos(String nombre) {
        return tarea -> {
            Thread hilo = new Thread(tarea, nombre);
            hilo.setDaemon(true);
            return hilo;
        };
    }

    /** Una comprobación con su último resultado y la ejecución en curso. */
    private final class Comprobacion {

        private final String nombre;
        private final BooleanSupplier prueba;
        private final AtomicLong estado = new AtomicLong(SIN_DATOS);
        private Future<Boolean> enCurso;

        private Comprobacion(String nombre, BooleanSupplier prueba) {
            this.nombre = nombre;
            this.prueba = prueba;
        }

        private synchronized void verificar() {
            // Si la anterior sigue colgada no se lanza otra: se vuelve a esperar
            // la misma, y mientras no conteste el componente sigue caído.
            if (enCurso == null || enCurso.isDone()) {
                Callable<Boolean> tarea = prueba::getAsBoolean;
                enCurso = verificadores.submit(tarea);
            }
            try {
                marcar(enCurso.get(TIEMPO_LIMITE_MS, TimeUnit.MILLISECONDS), "sin_respuesta");
            } catch (TimeoutException e) {
                marcar(false, "tiempo_agotado");
            } catch (ExecutionException e) {
                Throwable causa = e.getCause() != null ? e.getCause() : e;
                marcar(false, causa.getClass().getSimpleName());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        private void marcar(boolean disponible, String motivo) {
            long nuevo = disponible ? 1 : 0;
            long anterior = estado.getAndSet(nuevo);
            if (anterior != nuevo) {
                if (disponible) {
                    LOG.info("componente_estado componente={} disponible=true", nombre);
                } else {
                    LOG.warn("componente_estado componente={} disponible=false motivo={}", nombre, motivo);
                }
            }
        }

        private double valor() {
            long actual = estado.get();
            return actual == SIN_DATOS ? Double.NaN : actual;
        }
    }
}
