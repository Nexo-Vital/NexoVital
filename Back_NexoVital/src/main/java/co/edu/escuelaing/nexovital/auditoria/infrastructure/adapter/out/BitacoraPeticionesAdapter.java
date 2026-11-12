package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.BitacoraPeticionesPort;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.GeolocalizadorIp;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Escritura asíncrona por lotes de la bitácora de peticiones (T13/T14).
 *
 * <p><b>Cómo funciona.</b> {@link #registrar} solo mete la fila en una cola en
 * memoria; un hilo propio la vacía cada {@code nexovital.bitacora.lote-ms}
 * (500 ms por defecto) con un único {@code INSERT} por lotes. Antes de escribir
 * resuelve el país de cada IP. El hilo de la petición nunca espera a la base.
 *
 * <p><b>El 100 % se registra.</b> Lo que podría perder filas está cubierto:
 * <ul>
 *   <li>Cola llena (un pico enorme): la fila se escribe en el momento, en el
 *       hilo de la petición. Es más lento, pero no se pierde.</li>
 *   <li>La base falla al escribir el lote: cada fila se deja en el log como
 *       {@code bitacora_respaldo} con todos sus campos, y el log va a la
 *       salida estructurada que se conserva.</li>
 *   <li>Apagado ordenado: {@link #apagar} vacía la cola antes de que se cierre
 *       la conexión a la base.</li>
 * </ul>
 * Lo único que no se cubre es que el proceso muera de golpe (kill -9): se
 * perderían, como máximo, las filas de los últimos 500 ms.
 *
 * <p>La tabla no se distribuye en Citus: es una tabla local del coordinador,
 * igual que {@code auditoria_eventos}, con la que se cruza en las consultas.
 */
@Component
public class BitacoraPeticionesAdapter implements BitacoraPeticionesPort {

    private static final Logger LOG = LoggerFactory.getLogger(BitacoraPeticionesAdapter.class);

    private static final String COLUMNAS = "id, ocurrido_en, canal, metodo, ruta, estado, duracion_ms, "
            + "usuario_id, usuario_rol, actor, ip, pais, navegador, trace_id, instancia, detalle";

    private static final String INSERTAR = "INSERT INTO auditoria_peticiones (" + COLUMNAS
            + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate jdbcConNombres;
    private final GeolocalizadorIp geolocalizador;
    private final BlockingQueue<PeticionRegistrada> cola;
    private final int tamanoLote;
    private final ScheduledExecutorService escritor;
    private final AtomicLong escritasDirecto = new AtomicLong();

    public BitacoraPeticionesAdapter(JdbcTemplate jdbc,
                                     NamedParameterJdbcTemplate jdbcConNombres,
                                     GeolocalizadorIp geolocalizador,
                                     @Value("${nexovital.bitacora.capacidad:50000}") int capacidad,
                                     @Value("${nexovital.bitacora.tamano-lote:500}") int tamanoLote,
                                     @Value("${nexovital.bitacora.lote-ms:500}") long periodoMs) {
        this.jdbc = jdbc;
        this.jdbcConNombres = jdbcConNombres;
        this.geolocalizador = geolocalizador;
        this.cola = new ArrayBlockingQueue<>(capacidad);
        this.tamanoLote = tamanoLote;
        this.escritor = Executors.newSingleThreadScheduledExecutor(tarea -> {
            Thread hilo = new Thread(tarea, "bitacora-escritor");
            hilo.setDaemon(true);
            return hilo;
        });
        this.escritor.scheduleWithFixedDelay(this::vaciarSinFallar, periodoMs, periodoMs, TimeUnit.MILLISECONDS);
    }

    @Override
    public void registrar(PeticionRegistrada peticion) {
        if (!cola.offer(peticion)) {
            // Cola llena: se escribe ya, en este hilo, antes que perderla.
            if (escritasDirecto.getAndIncrement() % 1000 == 0) {
                LOG.warn("bitacora_cola_llena: se escribe de forma sincrona (pendientes={})", cola.size());
            }
            escribir(List.of(peticion));
        }
    }

    /**
     * Escribe todo lo pendiente. Lo usa el hilo escritor y lo pueden llamar las
     * pruebas para no depender del temporizador.
     */
    public synchronized void vaciar() {
        List<PeticionRegistrada> lote = new ArrayList<>(tamanoLote);
        while (cola.drainTo(lote, tamanoLote) > 0) {
            escribir(lote);
            lote.clear();
        }
    }

    /** Filas que esperan en la cola. */
    public int pendientes() {
        return cola.size();
    }

    @PreDestroy
    void apagar() {
        escritor.shutdown();
        try {
            escritor.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        vaciar();
    }

    private void vaciarSinFallar() {
        try {
            vaciar();
        } catch (RuntimeException e) {
            // Nunca debe matar al hilo: si muere, la cola deja de vaciarse.
            LOG.error("bitacora_error al vaciar la cola", e);
        }
    }

    private void escribir(List<PeticionRegistrada> lote) {
        List<PeticionRegistrada> conPais = lote.stream()
                .map(p -> p.pais() != null ? p : p.conPais(geolocalizador.paisDe(p.ip())))
                .toList();
        try {
            jdbc.batchUpdate(INSERTAR, conPais, conPais.size(), BitacoraPeticionesAdapter::llenar);
        } catch (RuntimeException e) {
            LOG.error("bitacora_error no se pudo escribir un lote de {} filas; quedan en el log", conPais.size(), e);
            for (PeticionRegistrada p : conPais) {
                LOG.warn("bitacora_respaldo id={} hora={} canal={} metodo={} ruta={} estado={} usuario={} "
                                + "actor={} ip={} pais={} navegador=\"{}\" traceId={} instancia={} detalle={}",
                        p.id(), p.ocurridoEn(), p.canal(), p.metodo(), p.ruta(), p.estado(), p.usuarioId(),
                        p.actor(), p.ip(), p.pais(), p.navegador(), p.traceId(), p.instancia(), p.detalle());
            }
        }
    }

    private static void llenar(PreparedStatement ps, PeticionRegistrada p) throws SQLException {
        ps.setObject(1, p.id());
        ps.setTimestamp(2, Timestamp.from(p.ocurridoEn()));
        ps.setString(3, p.canal());
        ps.setString(4, p.metodo());
        ps.setString(5, p.ruta());
        ps.setInt(6, p.estado());
        if (p.duracionMs() == null) {
            ps.setNull(7, Types.BIGINT);
        } else {
            ps.setLong(7, p.duracionMs());
        }
        if (p.usuarioId() == null) {
            ps.setNull(8, Types.OTHER);
        } else {
            ps.setObject(8, p.usuarioId());
        }
        ps.setString(9, p.usuarioRol());
        ps.setString(10, p.actor());
        ps.setString(11, p.ip());
        ps.setString(12, p.pais());
        ps.setString(13, p.navegador());
        ps.setString(14, p.traceId());
        ps.setString(15, p.instancia());
        ps.setString(16, p.detalle());
    }

    @Override
    public List<PeticionRegistrada> buscar(FiltroBitacora filtro) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLUMNAS)
                .append(" FROM auditoria_peticiones WHERE 1 = 1");
        MapSqlParameterSource parametros = new MapSqlParameterSource();
        if (filtro.traceId() != null && !filtro.traceId().isBlank()) {
            sql.append(" AND trace_id = :traceId");
            parametros.addValue("traceId", filtro.traceId());
        }
        if (filtro.usuarioId() != null) {
            sql.append(" AND usuario_id = :usuarioId");
            parametros.addValue("usuarioId", filtro.usuarioId());
        }
        if (filtro.recursoId() != null) {
            // Una emergencia o un centro: las peticiones cuya ruta lleva el id,
            // y las que originaron una acción crítica sobre él (el POST que creó
            // la emergencia no tiene el id en la ruta, pero sí el mismo traceId).
            sql.append(" AND (ruta LIKE :patron OR trace_id IN (SELECT e.trace_id FROM auditoria_eventos e"
                    + " WHERE e.recurso_id = :recursoId AND e.trace_id IS NOT NULL))");
            parametros.addValue("patron", "%" + filtro.recursoId() + "%");
            parametros.addValue("recursoId", filtro.recursoId());
        }
        if (filtro.desde() != null) {
            sql.append(" AND ocurrido_en >= :desde");
            parametros.addValue("desde", Timestamp.from(filtro.desde()));
        }
        if (filtro.hasta() != null) {
            sql.append(" AND ocurrido_en <= :hasta");
            parametros.addValue("hasta", Timestamp.from(filtro.hasta()));
        }
        sql.append(" ORDER BY ocurrido_en DESC, id LIMIT :limite");
        parametros.addValue("limite", filtro.limite());
        return jdbcConNombres.query(sql.toString(), parametros, BitacoraPeticionesAdapter::leer);
    }

    private static PeticionRegistrada leer(ResultSet rs, int fila) throws SQLException {
        long duracion = rs.getLong("duracion_ms");
        Long duracionMs = rs.wasNull() ? null : duracion;
        return new PeticionRegistrada(
                rs.getObject("id", UUID.class),
                rs.getObject("ocurrido_en", OffsetDateTime.class).toInstant(),
                rs.getString("canal"),
                rs.getString("metodo"),
                rs.getString("ruta"),
                rs.getInt("estado"),
                duracionMs,
                rs.getObject("usuario_id", UUID.class),
                rs.getString("usuario_rol"),
                rs.getString("actor"),
                rs.getString("ip"),
                rs.getString("pais"),
                rs.getString("navegador"),
                rs.getString("trace_id"),
                rs.getString("instancia"),
                rs.getString("detalle"));
    }
}
