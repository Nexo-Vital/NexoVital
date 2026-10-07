package co.edu.escuelaing.nexovital.realtime;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DetectarSenalPerdidaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import co.edu.escuelaing.nexovital.support.MutableClock;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandler;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.socket.sockjs.client.SockJsClient;
import org.springframework.web.socket.sockjs.client.Transport;
import org.springframework.web.socket.sockjs.client.WebSocketTransport;

import java.lang.reflect.Type;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * End-to-end proof of the ambulance position channel (EP-04.F1.US1, task
 * "probar múltiples clientes, reconexión y pérdida de señal"; test cases P1,
 * P2, P3 and P10 of the design, plus the reconnection of D7).
 *
 * <p>Nothing is faked on the wire: ten real users log in, open a SockJS/STOMP
 * session and subscribe to {@code /topic/flota}; the position enters through
 * the real {@code POST /api/v1/flota/ambulancias/{id}/posicion} (real
 * transaction, real AFTER_COMMIT push, real broker). SockJS with a single
 * WebSocket transport is what the front uses.
 *
 * <p>Only the clock is controlled ({@link TestClockConfig}): the 30-second
 * signal threshold is crossed by advancing it, never by sleeping the suite. The
 * scheduled sweep is disabled by the test profile, so the signal-loss use case
 * is driven directly.
 *
 * <p>The test seeds its own unit for the reporting driver and deletes it
 * afterwards: the test H2 is shared and other fleet tests assert the seeded
 * catalog. Every assertion filters the frames by that unit's id.
 *
 * <p>All timeouts are explicit and every client is closed afterwards: a STOMP
 * client left open hangs the suite.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class FlotaPosicionRealtimeTest {

    /** The driver that reports: it owns the unit this test seeds. */
    private static final String CONDUCTOR = "conductor1@nexovital.co";
    private static final String CONDUCTOR_PASSWORD = "conductor123";

    /**
     * Ten DIFFERENT connected users, as scenario 2 of the story asks ("dado que
     * hay 10 usuarios conectados"): every role is represented.
     */
    private static final List<String[]> ESPECTADORES = List.of(
            new String[] {"rangel@nexovital.co", "rangel123"},
            new String[] {"admin@nexovital.co", "admin123"},
            new String[] {"centro@nexovital.co", "centro123"},
            new String[] {"acopio@nexovital.co", "acopio123"},
            new String[] {"ciudadano@nexovital.co", "ciudadano123"},
            new String[] {"ciudadano2@nexovital.co", "ciudadano123"},
            new String[] {"conductor2@nexovital.co", "conductor123"},
            new String[] {"conductor3@nexovital.co", "conductor123"},
            new String[] {"conductor4@nexovital.co", "conductor123"},
            new String[] {"conductor5@nexovital.co", "conductor123"});

    private static final String DESTINO_FLOTA = "/topic/flota";

    /** Same reset LoginTestBase applies: a blocked account must not fail the login here. */
    private static final String REINICIAR_ESTADO_INTENTOS =
            "UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL";

    /** Upper bound for connect, subscribe and frames. */
    private static final long TIMEOUT_SEGUNDOS = 10;
    /** P1/P2 of the design: the frame must arrive in less than 2 seconds. */
    private static final long LATENCIA_MAXIMA_NANOS = TimeUnit.SECONDS.toNanos(2);
    /** Position interval of the story. */
    private static final Duration INTERVALO = Duration.ofSeconds(5);
    /** More than the 30-second signal threshold. */
    private static final Duration MAS_DEL_UMBRAL = Duration.ofSeconds(31);

    @LocalServerPort
    private int puerto;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PushPort pushPort;

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private DetectarSenalPerdidaUseCase detectarSenalPerdidaUseCase;

    @Autowired
    private MutableClock clock;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private ThreadPoolTaskScheduler planificador;
    private final List<SesionStomp> sesiones = new ArrayList<>();

    /** The unit this test owns, driven by {@link #CONDUCTOR}. */
    private UUID unidad;
    private String tokenConductor;

    @BeforeEach
    void preparar() throws Exception {
        clock.fijar(TestClockConfig.INSTANTE_BASE);
        jdbcTemplate.update(REINICIAR_ESTADO_INTENTOS);

        planificador = new ThreadPoolTaskScheduler();
        planificador.setPoolSize(4);
        planificador.setThreadNamePrefix("stomp-posicion-test-");
        planificador.setDaemon(true);
        planificador.initialize();

        UUID conductorId = usuarioRepository.buscarPorEmail(CONDUCTOR)
                .orElseThrow(() -> new AssertionError("seeded driver not found: " + CONDUCTOR))
                .getId();
        unidad = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidad, "RTM" + unidad.toString().substring(0, 8), EstadoAmbulancia.DISPONIBLE,
                4.70d, -74.00d, "Realtime-" + unidad, conductorId));

        tokenConductor = iniciarSesion(CONDUCTOR, CONDUCTOR_PASSWORD);
    }

    @AfterEach
    void cerrarTodo() {
        for (SesionStomp sesion : sesiones) {
            sesion.cerrar();
        }
        sesiones.clear();
        if (planificador != null) {
            planificador.shutdown();
        }
        if (unidad != null) {
            ambulanciaJpaRepository.deleteAllById(List.of(unidad));
        }
        clock.fijar(TestClockConfig.INSTANTE_BASE);
    }

    // -----------------------------------------------------------------------
    // P1 / P2 — ten connected users see the same position, none of them stale
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P1/P2: 10 usuarios conectados reciben el mismo frame de posición (misma versión y posición) en menos de 2 s")
    void p2_diezUsuariosRecibenLaMismaPosicion() throws Exception {
        List<SesionStomp> espectadores = abrirEspectadores(ESPECTADORES.size());

        long disparoNanos = System.nanoTime();
        JsonNode respuesta = reportarPosicion(4.7411d, -74.0822d, 135);
        long versionGuardada = respuesta.get("version").asLong();

        for (int i = 0; i < espectadores.size(); i++) {
            Recibido recibido = esperarFrameDeLaUnidad(espectadores.get(i));
            assertNotNull(recibido, "el usuario " + ESPECTADORES.get(i)[0] + " debe recibir la posición sin recargar");
            JsonNode frame = recibido.frame();
            assertEquals(4.7411d, frame.get("ubicacion").get("lat").asDouble(), "misma posición para todos");
            assertEquals(-74.0822d, frame.get("ubicacion").get("lng").asDouble(), "misma posición para todos");
            assertEquals(versionGuardada, frame.get("version").asLong(),
                    "misma versión para todos, y es la que quedó guardada");
            assertEquals("AVAILABLE", frame.get("estado").asText());
            assertEquals(135, frame.get("heading").asInt());
            assertEquals("device", frame.get("source").asText());
            assertFalse(frame.get("sinSenal").asBoolean());
            assertEquals(TestClockConfig.INSTANTE_BASE, Instant.parse(frame.get("ultimaPosicionEn").asText()));
            assertTrue(recibido.nanos() - disparoNanos < LATENCIA_MAXIMA_NANOS,
                    "el usuario " + ESPECTADORES.get(i)[0] + " debe recibir el frame en menos de 2 s");
        }
    }

    @Test
    @DisplayName("Escenarios 1 a 3: tras varios reportes cada 5 s los 10 usuarios terminan en la misma posición, en orden, y quien llega tarde la ve por REST")
    void variosReportes_todosConvergenYElTardioVeLoMismo() throws Exception {
        List<SesionStomp> espectadores = abrirEspectadores(ESPECTADORES.size());

        int reportes = 5;
        List<Long> versionesGuardadas = new ArrayList<>();
        double ultimaLat = 0.0d;
        double ultimaLng = 0.0d;
        for (int i = 1; i <= reportes; i++) {
            clock.avanzar(INTERVALO);
            ultimaLat = 4.70d + i * 0.001d;
            ultimaLng = -74.00d - i * 0.001d;
            versionesGuardadas.add(reportarPosicion(ultimaLat, ultimaLng, 90).get("version").asLong());
        }
        Instant instanteDelUltimo = clock.instant();
        for (int i = 1; i < versionesGuardadas.size(); i++) {
            assertTrue(versionesGuardadas.get(i) > versionesGuardadas.get(i - 1),
                    "cada reporte sube la versión de la unidad");
        }

        // Every user receives EVERY report, in the order it was written, and
        // therefore ends on the same last position: none of them is stale.
        for (int i = 0; i < espectadores.size(); i++) {
            List<Long> versionesRecibidas = new ArrayList<>();
            JsonNode ultimoFrame = null;
            for (int r = 0; r < reportes; r++) {
                Recibido recibido = esperarFrameDeLaUnidad(espectadores.get(i));
                assertNotNull(recibido,
                        "el usuario " + ESPECTADORES.get(i)[0] + " debe recibir el reporte " + (r + 1));
                versionesRecibidas.add(recibido.frame().get("version").asLong());
                ultimoFrame = recibido.frame();
            }
            assertEquals(versionesGuardadas, versionesRecibidas,
                    "el usuario " + ESPECTADORES.get(i)[0] + " recibe todos los reportes y en orden");
            assertEquals(ultimaLat, ultimoFrame.get("ubicacion").get("lat").asDouble(),
                    "todos terminan en la última posición");
            assertEquals(ultimaLng, ultimoFrame.get("ubicacion").get("lng").asDouble(),
                    "todos terminan en la última posición");
        }

        // P3: a user that connects only now was never subscribed. The broker
        // does not replay, so the REST read is what shows the last position.
        JsonNode dto = unidadPorRest(iniciarSesion("ciudadano@nexovital.co", "ciudadano123"));
        assertEquals(ultimaLat, dto.get("ubicacion").get("lat").asDouble(),
                "quien llega tarde ve de inmediato la última posición");
        assertEquals(ultimaLng, dto.get("ubicacion").get("lng").asDouble());
        assertEquals(versionesGuardadas.get(reportes - 1).longValue(), dto.get("version").asLong(),
                "con la misma versión que el último frame que vieron los demás");
        assertEquals(instanteDelUltimo, Instant.parse(dto.get("ultimaPosicionEn").asText()));
        assertFalse(dto.get("sinSenal").asBoolean());
    }

    // -----------------------------------------------------------------------
    // Scenario 4 — signal loss reaches every connected user
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Escenario 4: pasados 31 s sin reportar, los 10 usuarios reciben 'sin señal' con la última posición; al volver a reportar la recuperan")
    void sinSenal_llegaATodosYSeRecuperaAlReportar() throws Exception {
        List<SesionStomp> espectadores = abrirEspectadores(ESPECTADORES.size());

        long versionDelReporte = reportarPosicion(4.7455d, -74.0766d, 45).get("version").asLong();
        for (SesionStomp espectador : espectadores) {
            assertNotNull(esperarFrameDeLaUnidad(espectador), "precondición: todos vieron el reporte");
        }

        // The driver stops reporting. More than 30 s later the sweep runs.
        clock.avanzar(MAS_DEL_UMBRAL);
        assertTrue(detectarSenalPerdidaUseCase.detectar() >= 1, "el barrido marca la unidad vencida");

        for (int i = 0; i < espectadores.size(); i++) {
            Recibido recibido = esperarFrameDeLaUnidad(espectadores.get(i));
            assertNotNull(recibido, "el usuario " + ESPECTADORES.get(i)[0] + " debe recibir el aviso de sin señal");
            JsonNode aviso = recibido.frame();
            assertTrue(aviso.get("sinSenal").asBoolean(), "el frame dice sin señal");
            assertEquals(4.7455d, aviso.get("ubicacion").get("lat").asDouble(),
                    "conserva la última posición conocida");
            assertEquals(-74.0766d, aviso.get("ubicacion").get("lng").asDouble(),
                    "conserva la última posición conocida");
            assertEquals("AVAILABLE", aviso.get("estado").asText(), "el estado de la unidad no cambia");
            assertEquals(versionDelReporte + 1, aviso.get("version").asLong());
            assertEquals(TestClockConfig.INSTANTE_BASE, Instant.parse(aviso.get("ultimaPosicionEn").asText()),
                    "el instante es el del último reporte, no el del aviso");
        }

        // A late user sees the same over REST.
        JsonNode dtoSinSenal = unidadPorRest(tokenConductor);
        assertTrue(dtoSinSenal.get("sinSenal").asBoolean());
        assertEquals(4.7455d, dtoSinSenal.get("ubicacion").get("lat").asDouble());

        // A second sweep does not repeat the notice: the next frame anybody
        // receives is the driver's new report, with signal again.
        detectarSenalPerdidaUseCase.detectar();
        long versionDelRegreso = reportarPosicion(4.7466d, -74.0755d, 60).get("version").asLong();
        assertTrue(versionDelRegreso > versionDelReporte + 1);

        for (int i = 0; i < espectadores.size(); i++) {
            Recibido recibido = esperarFrameDeLaUnidad(espectadores.get(i));
            assertNotNull(recibido, "el usuario " + ESPECTADORES.get(i)[0] + " debe recibir el regreso de la señal");
            JsonNode regreso = recibido.frame();
            assertFalse(regreso.get("sinSenal").asBoolean(),
                    "el frame siguiente al aviso es el reporte: el aviso no se repitió");
            assertEquals(versionDelRegreso, regreso.get("version").asLong());
            assertEquals(4.7466d, regreso.get("ubicacion").get("lat").asDouble());
        }
    }

    // -----------------------------------------------------------------------
    // D7 — reconnection: what was published during the cut is read over REST
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Reconexión: lo publicado durante el corte no se reenvía; al volver, el cliente lo recupera por REST y sigue recibiendo en orden")
    void reconexion_elClienteRecuperaLoPerdidoPorRest() throws Exception {
        String tokenCiudadano = iniciarSesion("ciudadano@nexovital.co", "ciudadano123");
        String tokenRangel = iniciarSesion("rangel@nexovital.co", "rangel123");
        SesionStomp seCae = abrirSesion(tokenCiudadano);
        SesionStomp siempreConectado = abrirSesion(tokenRangel);
        confirmarSuscripciones(List.of(seCae, siempreConectado));

        // 1. Both see the first report.
        long version1 = reportarPosicion(4.7101d, -74.0101d, 10).get("version").asLong();
        assertEquals(version1, frameDe(seCae, "el cliente que luego se cae").get("version").asLong());
        assertEquals(version1, frameDe(siempreConectado, "el cliente siempre conectado").get("version").asLong());

        // 2. One client loses its channel. A report is published during the cut.
        seCae.cerrar();
        clock.avanzar(INTERVALO);
        long version2 = reportarPosicion(4.7202d, -74.0202d, 20).get("version").asLong();
        assertEquals(version2, frameDe(siempreConectado, "el cliente siempre conectado").get("version").asLong(),
                "quien siguió conectado sí recibe el reporte");

        // 3. The client comes back with a NEW session and subscribes again.
        SesionStomp reconectado = abrirSesion(tokenCiudadano);
        confirmarSuscripciones(List.of(reconectado));

        // The broker does not replay the frame it missed...
        assertNull(esperarFrameDeLaUnidad(reconectado, 1), "el broker no reenvía lo publicado durante el corte");
        // ...so the snapshot it reads on reconnect is what brings it up to date.
        JsonNode snapshot = unidadPorRest(tokenCiudadano);
        assertEquals(4.7202d, snapshot.get("ubicacion").get("lat").asDouble(),
                "la relectura REST trae la posición publicada durante el corte");
        assertEquals(version2, snapshot.get("version").asLong());
        assertTrue(snapshot.get("version").asLong() > version1,
                "la versión del snapshot es mayor que la del último frame que el cliente tenía: "
                        + "el front lo acepta en vez de quedarse con el dato viejo");

        // 4. The channel works again, and the order continues from the snapshot.
        clock.avanzar(INTERVALO);
        long version3 = reportarPosicion(4.7303d, -74.0303d, 30).get("version").asLong();
        JsonNode frameTrasReconectar = frameDe(reconectado, "el cliente reconectado");
        assertEquals(version3, frameTrasReconectar.get("version").asLong());
        assertEquals(4.7303d, frameTrasReconectar.get("ubicacion").get("lat").asDouble());
        assertTrue(version3 > version2, "el frame nuevo es más nuevo que el snapshot: se aplica");
        assertEquals(version3, frameDe(siempreConectado, "el cliente siempre conectado").get("version").asLong(),
                "y ambos clientes terminan en la misma posición");
    }

    // -----------------------------------------------------------------------
    // P10 — the channel is one-way: a client cannot publish positions
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P10: un cliente que envía una posición falsa a /topic/flota no la propaga a nadie ni mueve la unidad")
    void p10_unClienteNoPuedePublicarEnElTopico() throws Exception {
        SesionStomp espectador = abrirSesion(iniciarSesion("ciudadano@nexovital.co", "ciudadano123"));
        SesionStomp otroEspectador = abrirSesion(iniciarSesion("rangel@nexovital.co", "rangel123"));
        SesionStomp intruso = abrirSesion(iniciarSesion("conductor2@nexovital.co", "conductor123"));
        confirmarSuscripciones(List.of(espectador, otroEspectador, intruso));

        // A forged frame with the exact shape of a real one, for a unit that is
        // not the sender's.
        intruso.enviar(DESTINO_FLOTA, Map.of(
                "ambulanceId", unidad.toString(),
                "ubicacion", Map.of("lat", 9.99d, "lng", -9.99d),
                "estado", "MAINTENANCE",
                "heading", 0,
                "source", "device",
                "sinSenal", true,
                "version", 999_999));

        // A real report right after it is the sentinel: it travels the same
        // broker, so if the forged frame had been relayed it would be in the
        // queues too.
        long versionReal = reportarPosicion(4.7123d, -74.0123d, 15).get("version").asLong();

        for (SesionStomp sesion : List.of(espectador, otroEspectador, intruso)) {
            List<JsonNode> frames = new ArrayList<>();
            Recibido primero = esperarFrameDeLaUnidad(sesion);
            assertNotNull(primero, "el reporte real sí llega");
            frames.add(primero.frame());
            // Anything else that may still be on its way.
            Recibido siguiente = esperarFrameDeLaUnidad(sesion, 1);
            while (siguiente != null) {
                frames.add(siguiente.frame());
                siguiente = esperarFrameDeLaUnidad(sesion, 1);
            }
            assertEquals(1, frames.size(), "solo llega el frame que publicó el servidor: " + frames);
            assertEquals(versionReal, frames.get(0).get("version").asLong());
            assertEquals(4.7123d, frames.get(0).get("ubicacion").get("lat").asDouble());
            assertFalse(frames.get(0).get("sinSenal").asBoolean());
        }

        // The forged frame never touched the database either.
        AmbulanciaJpaEntity fila = ambulanciaJpaRepository.findById(unidad).orElseThrow();
        assertEquals(4.7123d, fila.getLat());
        assertEquals(EstadoAmbulancia.DISPONIBLE, fila.getEstado());
        assertFalse(fila.isSinSenal());

        // The discard is silent: the sender keeps its session and keeps listening.
        assertTrue(intruso.conectada(), "descartar el SEND no cierra la sesión del cliente");
        assertNull(intruso.causaRechazo.get(), "ni le devuelve un error");
    }

    // -----------------------------------------------------------------------
    // Test infrastructure
    // -----------------------------------------------------------------------

    /** Logs in {@code cantidad} different users and leaves each one subscribed to the fleet topic. */
    private List<SesionStomp> abrirEspectadores(int cantidad) throws Exception {
        List<SesionStomp> espectadores = new ArrayList<>();
        for (int i = 0; i < cantidad; i++) {
            String[] cuenta = ESPECTADORES.get(i);
            espectadores.add(abrirSesion(iniciarSesion(cuenta[0], cuenta[1])));
        }
        confirmarSuscripciones(espectadores);
        return espectadores;
    }

    private SesionStomp abrirSesion(String token) throws Exception {
        SesionStomp sesion = new SesionStomp(planificador);
        sesiones.add(sesion);
        sesion.conectar(urlWs(), token);
        sesion.suscribir(DESTINO_FLOTA);
        return sesion;
    }

    /**
     * Confirms the broker already registered the subscriptions. Spring's simple
     * broker emits no RECEIPT for SUBSCRIBE, so the only reliable signal is a
     * message published AFTER the SUBSCRIBE: a warm-up mark is retried through
     * the real PushPort until it reaches every session. Without it the real
     * frame could be lost in the window between the SUBSCRIBE and its
     * registration. The mark has no {@code ambulanceId}, so it can never be
     * mistaken for a frame of the unit.
     */
    private void confirmarSuscripciones(List<SesionStomp> porConfirmar) throws Exception {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS * 2);
        while (System.nanoTime() < limite) {
            for (SesionStomp sesion : porConfirmar) {
                sesion.drenar();
            }
            pushPort.publicar(DESTINO_FLOTA, Map.of("tipo", "calentamiento-suscripcion"));

            int recibieron = 0;
            for (SesionStomp sesion : porConfirmar) {
                if (sesion.esperar(1) != null) {
                    recibieron++;
                }
            }
            if (recibieron == porConfirmar.size()) {
                // Let any retried mark still in flight land, then start clean.
                Thread.sleep(200L);
                for (SesionStomp sesion : porConfirmar) {
                    sesion.drenar();
                }
                return;
            }
        }
        StringBuilder causas = new StringBuilder();
        for (SesionStomp sesion : porConfirmar) {
            causas.append('[').append(sesion.causaRechazo.get()).append(']');
        }
        fail("no se pudo confirmar que las suscripciones a " + DESTINO_FLOTA
                + " estén activas; causas=" + causas);
    }

    private Recibido esperarFrameDeLaUnidad(SesionStomp sesion) throws Exception {
        return esperarFrameDeLaUnidad(sesion, TIMEOUT_SEGUNDOS);
    }

    /** Next frame of the unit, failing the test with a readable message if it never arrives. */
    private JsonNode frameDe(SesionStomp sesion, String quien) throws Exception {
        Recibido recibido = esperarFrameDeLaUnidad(sesion);
        assertNotNull(recibido, quien + " no recibió el frame de la unidad a tiempo");
        return recibido.frame();
    }

    /**
     * Next frame of THE unit of this test, or {@code null} if none arrives in
     * time. Any other frame on the topic (a warm-up mark, another unit) is
     * skipped.
     */
    private Recibido esperarFrameDeLaUnidad(SesionStomp sesion, long segundos) throws Exception {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(segundos);
        long restante = limite - System.nanoTime();
        while (restante > 0) {
            Recibido recibido = sesion.esperarNanos(restante);
            if (recibido == null) {
                return null;
            }
            JsonNode frame = recibido.frame();
            if (frame.hasNonNull("ambulanceId") && unidad.toString().equals(frame.get("ambulanceId").asText())) {
                return recibido;
            }
            restante = limite - System.nanoTime();
        }
        return null;
    }

    /** The real driver route: {@code POST /flota/ambulancias/{id}/posicion}. Returns the 200 body. */
    private JsonNode reportarPosicion(double lat, double lng, int heading) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(tokenConductor);
        Map<String, Object> cuerpo = Map.of(
                "ubicacion", Map.of("lat", lat, "lng", lng),
                "heading", heading);
        ResponseEntity<String> respuesta = restTemplate.postForEntity(
                "/api/v1/flota/ambulancias/" + unidad + "/posicion",
                new HttpEntity<>(cuerpo, headers), String.class);
        assertEquals(HttpStatus.OK, respuesta.getStatusCode(),
                "el reporte real de posición debe responder 200: " + respuesta.getBody());
        return objectMapper.readTree(respuesta.getBody());
    }

    /** The unit of this test as {@code GET /flota/ambulancias} returns it. */
    private JsonNode unidadPorRest(String token) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        ResponseEntity<String> listado = restTemplate.exchange(
                "/api/v1/flota/ambulancias", HttpMethod.GET, new HttpEntity<>(headers), String.class);
        assertEquals(HttpStatus.OK, listado.getStatusCode(), "GET /flota/ambulancias debe responder 200");
        for (JsonNode dto : objectMapper.readTree(listado.getBody())) {
            if (unidad.toString().equals(dto.get("id").asText())) {
                return dto;
            }
        }
        throw new AssertionError("la flota no incluye la unidad " + unidad);
    }

    private String urlWs() {
        return "ws://localhost:" + puerto + "/ws";
    }

    private String iniciarSesion(String email, String password) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        Map<String, String> cuerpo = Map.of("email", email, "password", password);

        ResponseEntity<String> respuesta = restTemplate.postForEntity(
                "/api/v1/sesiones", new HttpEntity<>(cuerpo, headers), String.class);

        assertEquals(HttpStatus.OK, respuesta.getStatusCode(), "el login real debe responder 200 para " + email);
        return objectMapper.readTree(respuesta.getBody()).get("token").asText();
    }

    /** A frame and the instant it reached the client. */
    private record Recibido(JsonNode frame, long nanos) {
    }

    /**
     * Test STOMP session: connects, confirms CONNECT with a latch, subscribes
     * and queues every received frame with its arrival time. SockJS with a
     * single WebSocket transport, which is what the front uses.
     */
    private static final class SesionStomp {

        private static final String CABECERA_AUTHORIZATION = "Authorization";

        private final WebSocketStompClient cliente;
        private final StompHeaders connectHeaders = new StompHeaders();
        private final CountDownLatch conectado = new CountDownLatch(1);
        private final AtomicReference<Throwable> causaRechazo = new AtomicReference<>();
        private final BlockingQueue<Recibido> recibidos = new LinkedBlockingQueue<>();
        private final List<StompSession.Subscription> suscripciones = new ArrayList<>();

        private volatile StompSession sesion;

        SesionStomp(ThreadPoolTaskScheduler planificador) {
            List<Transport> transportes =
                    List.of(new WebSocketTransport(new StandardWebSocketClient()));
            this.cliente = new WebSocketStompClient(new SockJsClient(transportes));
            this.cliente.setMessageConverter(new MappingJackson2MessageConverter());
            this.cliente.setTaskScheduler(planificador);
            this.cliente.start();
        }

        void conectar(String url, String token) {
            connectHeaders.add(CABECERA_AUTHORIZATION, "Bearer " + token);
            StompSessionHandler handler = new StompSessionHandlerAdapter() {
                @Override
                public void afterConnected(StompSession session, StompHeaders headers) {
                    sesion = session;
                    conectado.countDown();
                }

                @Override
                public void handleException(StompSession session, StompCommand command,
                                            StompHeaders headers, byte[] payload, Throwable exception) {
                    causaRechazo.compareAndSet(null, exception);
                }

                @Override
                public void handleTransportError(StompSession session, Throwable exception) {
                    causaRechazo.compareAndSet(null, exception);
                }
            };
            CompletableFuture<StompSession> futuro =
                    cliente.connectAsync(url, new WebSocketHttpHeaders(), connectHeaders, handler);
            assertNotNull(futuro, "connectAsync debe devolver un futuro");
        }

        void suscribir(String destino) throws Exception {
            assertTrue(conectado.await(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS),
                    "la sesión STOMP no recibió el CONNECT a tiempo: " + destino
                            + "; causa de rechazo=" + causaRechazo.get());

            StompFrameHandler recibidor = new StompFrameHandler() {
                @Override
                public Type getPayloadType(StompHeaders headers) {
                    return JsonNode.class;
                }

                @Override
                public void handleFrame(StompHeaders headers, Object payload) {
                    recibidos.add(new Recibido((JsonNode) payload, System.nanoTime()));
                }
            };
            suscripciones.add(sesion.subscribe(destino, recibidor));
        }

        /** A client SEND, exactly what a tampered front would do. */
        void enviar(String destino, Object payload) {
            sesion.send(destino, payload);
        }

        boolean conectada() {
            return sesion != null && sesion.isConnected();
        }

        /** Waits for any frame up to the timeout; {@code null} if none arrives. */
        Recibido esperar(long segundos) throws InterruptedException {
            return recibidos.poll(segundos, TimeUnit.SECONDS);
        }

        Recibido esperarNanos(long nanos) throws InterruptedException {
            return recibidos.poll(nanos, TimeUnit.NANOSECONDS);
        }

        void drenar() {
            recibidos.clear();
        }

        /** Closes subscriptions and session and stops the client. Safe to call twice. */
        void cerrar() {
            for (StompSession.Subscription suscripcion : suscripciones) {
                try {
                    suscripcion.unsubscribe();
                } catch (Exception ignorado) {
                    // Best-effort close: it must not mask the test result.
                }
            }
            suscripciones.clear();
            try {
                if (sesion != null && sesion.isConnected()) {
                    sesion.disconnect();
                }
            } catch (Exception ignorado) {
                // Idem.
            }
            try {
                cliente.stop();
            } catch (Exception ignorado) {
                // Idem.
            }
        }
    }
}
