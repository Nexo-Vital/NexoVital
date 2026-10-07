package co.edu.escuelaing.nexovital.realtime;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
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
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
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
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.socket.sockjs.client.SockJsClient;
import org.springframework.web.socket.sockjs.client.Transport;
import org.springframework.web.socket.sockjs.client.WebSocketTransport;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * EP-04.F2.US2 over the REAL channel: who receives the notification of a new
 * request, checked on the drivers' own STOMP sessions.
 *
 * <p>{@code SolicitudCandidatasHttpTest} already proves the rule by capturing
 * what the server publishes. This test closes the other half: every driver here
 * is logged in, holds an open SockJS/STOMP session and is subscribed to
 * {@code /user/queue/solicitudes}, exactly like the console. So a busy driver
 * is not "someone the server did not publish to": it is a subscribed client
 * that could receive the frame, and does not.
 *
 * <p><b>How "receives nothing" is proved.</b> Waiting for silence proves
 * little. After the request is created, a marked frame (a sentinel) is sent to
 * each excluded driver through the real {@code PushPort}. The broadcast, had it
 * been addressed to that driver, was published before the sentinel; so once the
 * sentinel arrives, everything that session received is inspected and none of
 * it may be the request. The sentinel also proves the session was able to
 * receive at that moment.
 *
 * <p>The five seeded drivers are used. Their units are set to the state each
 * scenario needs before it runs and are left available, connected and with
 * signal afterwards; the requests created are deleted.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class SolicitudBroadcastCandidatasRealtimeTest {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String PASSWORD_CONDUCTOR = "conductor123";
    private static final String CONDUCTOR_1 = "conductor1@nexovital.co";
    private static final String CONDUCTOR_2 = "conductor2@nexovital.co";
    private static final String CONDUCTOR_3 = "conductor3@nexovital.co";
    private static final String CONDUCTOR_4 = "conductor4@nexovital.co";
    private static final String CONDUCTOR_5 = "conductor5@nexovital.co";
    private static final List<String> CONDUCTORES =
            List.of(CONDUCTOR_1, CONDUCTOR_2, CONDUCTOR_3, CONDUCTOR_4, CONDUCTOR_5);

    /** The module publishes to this destination; the gateway prefixes the user. */
    private static final String DESTINO_SOLICITUDES = "/queue/solicitudes";
    /** The driver session subscribes to its OWN user destination. */
    private static final String DESTINO_SOLICITUDES_USUARIO = "/user/queue/solicitudes";
    private static final long TIMEOUT_SEGUNDOS = 10;
    /**
     * "At the same time": the copies of one request leave in the same pass,
     * right after the commit, so the gap between the first and the last driver
     * that receives it is a matter of milliseconds. One second is the project's
     * own real-time bound (see {@code CanalTiempoRealDosSesionesTest}).
     */
    private static final long MAXIMA_DIFERENCIA_MS = 1_000;
    /** Extra listening time after the sentinel, for a frame that arrived out of order. */
    private static final long GRACIA_MS = 500;

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
    private SolicitudJpaRepository solicitudJpaRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private SimpUserRegistry simpUserRegistry;

    private ThreadPoolTaskScheduler planificador;
    private final List<SesionStomp> sesiones = new ArrayList<>();
    private final List<UUID> solicitudesCreadas = new ArrayList<>();

    @BeforeEach
    void prepararPlanificadorYFlota() {
        planificador = new ThreadPoolTaskScheduler();
        planificador.setPoolSize(4);
        planificador.setThreadNamePrefix("stomp-us2-test-");
        planificador.setDaemon(true);
        planificador.initialize();

        // Known starting point, whatever a previous test left behind.
        for (String email : CONDUCTORES) {
            dejarCandidata(email);
        }
    }

    @AfterEach
    void cerrarYRestaurar() {
        for (SesionStomp sesion : sesiones) {
            sesion.cerrar();
        }
        sesiones.clear();
        planificador.shutdown();

        solicitudJpaRepository.deleteAllById(solicitudesCreadas);
        solicitudesCreadas.clear();
        for (String email : CONDUCTORES) {
            dejarCandidata(email);
        }
    }

    // -----------------------------------------------------------------------
    // Scenarios of the story
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("US2 esc. 1: cuatro ambulancias disponibles reciben la notificación al mismo tiempo")
    void cuatroDisponiblesRecibenAlMismoTiempo() throws Exception {
        Map<String, Conductor> conductores =
                abrirConsolas(CONDUCTOR_1, CONDUCTOR_2, CONDUCTOR_3, CONDUCTOR_4);

        JsonNode creada = crearSolicitud();

        Set<UUID> notificadas = notificadasDe(creada);
        List<Long> llegadas = new ArrayList<>();
        for (Conductor conductor : conductores.values()) {
            assertTrue(notificadas.contains(conductor.unidad()),
                    "la unidad disponible de " + conductor.email() + " debe estar entre las notificadas");
            Recibido recibido = esperarSolicitud(conductor, idDe(creada));
            assertNotNull(recibido,
                    conductor.email() + " está disponible y debe recibir la solicitud en su sesión");
            assertEquals("PENDIENTE", recibido.frame().get("estado").asText());
            llegadas.add(recibido.nanos());
        }

        long diferenciaMs = TimeUnit.NANOSECONDS.toMillis(
                llegadas.stream().mapToLong(Long::longValue).max().orElseThrow()
                        - llegadas.stream().mapToLong(Long::longValue).min().orElseThrow());
        assertTrue(diferenciaMs < MAXIMA_DIFERENCIA_MS,
                "las cuatro deben recibirla al mismo tiempo; entre la primera y la última pasaron "
                        + diferenciaMs + " ms");
    }

    @Test
    @DisplayName("US2 esc. 2: con 3 disponibles y 1 ocupada, solo las 3 reciben; la ocupada no recibe nada")
    void laOcupadaNoRecibeNada() throws Exception {
        fijarEstado(CONDUCTOR_4, EstadoAmbulancia.EN_MISION);
        Map<String, Conductor> conductores =
                abrirConsolas(CONDUCTOR_1, CONDUCTOR_2, CONDUCTOR_3, CONDUCTOR_4);
        Conductor ocupado = conductores.get(CONDUCTOR_4);

        JsonNode creada = crearSolicitud();

        Set<UUID> notificadas = notificadasDe(creada);
        for (String email : List.of(CONDUCTOR_1, CONDUCTOR_2, CONDUCTOR_3)) {
            Conductor disponible = conductores.get(email);
            assertTrue(notificadas.contains(disponible.unidad()));
            assertNotNull(esperarSolicitud(disponible, idDe(creada)),
                    email + " está disponible y debe recibir la solicitud en su sesión");
        }
        assertFalse(notificadas.contains(ocupado.unidad()),
                "la unidad ocupada no entra en la lista de notificadas");
        assertNoRecibio(ocupado, Set.of(idDe(creada)));
    }

    @Test
    @DisplayName("US2: la ocupada no recibe ninguna, sin importar cuántas solicitudes se disparen mientras atiende")
    void laOcupadaNoRecibeNingunaDeVariasSolicitudes() throws Exception {
        fijarEstado(CONDUCTOR_2, EstadoAmbulancia.EN_MISION);
        Map<String, Conductor> conductores = abrirConsolas(CONDUCTOR_1, CONDUCTOR_2);
        Conductor disponible = conductores.get(CONDUCTOR_1);
        Conductor ocupado = conductores.get(CONDUCTOR_2);

        Set<String> solicitudes = new HashSet<>();
        for (int i = 0; i < 3; i++) {
            solicitudes.add(idDe(crearSolicitud()));
        }

        // The available driver receives the three of them, one frame each.
        Set<String> recibidasPorElDisponible = new HashSet<>();
        while (recibidasPorElDisponible.size() < solicitudes.size()) {
            Recibido recibido = disponible.sesion().esperarFrame(TIMEOUT_SEGUNDOS);
            assertNotNull(recibido, "el conductor disponible debe recibir las tres solicitudes; lleva "
                    + recibidasPorElDisponible);
            if (esSolicitudNueva(recibido.frame())) {
                recibidasPorElDisponible.add(recibido.frame().get("solicitudId").asText());
            }
        }
        assertEquals(solicitudes, recibidasPorElDisponible);
        assertNoRecibio(ocupado, solicitudes);
    }

    @Test
    @DisplayName("US2: en ruta, fuera de servicio, desconectada o sin señal tampoco reciben; la disponible sí")
    void soloLaCandidataRecibe() throws Exception {
        fijarEstado(CONDUCTOR_2, EstadoAmbulancia.EN_RUTA);
        fijarEstado(CONDUCTOR_3, EstadoAmbulancia.MANTENIMIENTO);
        desconectar(CONDUCTOR_4);
        dejarSinSenal(CONDUCTOR_5);
        Map<String, Conductor> conductores = abrirConsolas(
                CONDUCTOR_1, CONDUCTOR_2, CONDUCTOR_3, CONDUCTOR_4, CONDUCTOR_5);

        JsonNode creada = crearSolicitud();

        Set<UUID> notificadas = notificadasDe(creada);
        Conductor candidata = conductores.get(CONDUCTOR_1);
        assertTrue(notificadas.contains(candidata.unidad()));
        assertNotNull(esperarSolicitud(candidata, idDe(creada)),
                "la única unidad disponible, conectada y con señal debe recibir la solicitud");
        for (String email : List.of(CONDUCTOR_2, CONDUCTOR_3, CONDUCTOR_4, CONDUCTOR_5)) {
            Conductor excluido = conductores.get(email);
            assertFalse(notificadas.contains(excluido.unidad()),
                    "una unidad que no es candidata no entra en la lista: " + email);
            assertNoRecibio(excluido, Set.of(idDe(creada)));
        }
    }

    // -----------------------------------------------------------------------
    // Scenario helpers
    // -----------------------------------------------------------------------

    /** A driver with an open, subscribed console session. */
    private record Conductor(String email, String usuarioId, UUID unidad, SesionStomp sesion) {
    }

    /** A received frame and the instant it reached the session. */
    private record Recibido(JsonNode frame, long nanos) {
    }

    /**
     * Logs each driver in, opens their STOMP session, subscribes it to the user
     * destination and confirms the broker is really delivering to it. The unit
     * states must be set BEFORE this is called.
     */
    private Map<String, Conductor> abrirConsolas(String... emails) throws Exception {
        Map<String, Conductor> conductores = new LinkedHashMap<>();
        for (String email : emails) {
            UUID usuarioId = usuarioRepository.buscarPorEmail(email)
                    .orElseThrow(() -> new AssertionError("no existe el conductor sembrado: " + email))
                    .getId();
            UUID unidad = unidadDe(email);
            SesionStomp sesion = new SesionStomp(planificador);
            sesiones.add(sesion);
            sesion.conectar(urlWs(), iniciarSesion(email, PASSWORD_CONDUCTOR));
            sesion.suscribir(DESTINO_SOLICITUDES_USUARIO);
            conductores.put(email, new Conductor(email, usuarioId.toString(), unidad, sesion));
        }
        confirmarSuscripciones(conductores.values());
        return conductores;
    }

    /** A real {@code POST /api/v1/solicitudes} from the citizen; it is deleted after the test. */
    private JsonNode crearSolicitud() throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD));
        Map<String, Object> cuerpo = Map.of("ubicacion", Map.of("lat", 4.73d, "lng", -74.08d));

        ResponseEntity<String> respuesta = restTemplate.postForEntity(
                "/api/v1/solicitudes", new HttpEntity<>(cuerpo, headers), String.class);

        assertEquals(HttpStatus.CREATED, respuesta.getStatusCode(),
                "el POST real debe responder 201; cuerpo=" + respuesta.getBody());
        JsonNode creada = objectMapper.readTree(respuesta.getBody());
        solicitudesCreadas.add(UUID.fromString(idDe(creada)));
        return creada;
    }

    private static String idDe(JsonNode solicitud) {
        return solicitud.get("id").asText();
    }

    private static Set<UUID> notificadasDe(JsonNode solicitud) {
        Set<UUID> notificadas = new HashSet<>();
        solicitud.get("ambulanciasNotificadas")
                .forEach(id -> notificadas.add(UUID.fromString(id.asText())));
        return notificadas;
    }

    /** The frame that offers a NEW request: it carries the id and is PENDIENTE. */
    private static boolean esSolicitudNueva(JsonNode frame) {
        return frame.hasNonNull("solicitudId")
                && "PENDIENTE".equals(frame.path("estado").asText());
    }

    /** Waits for the frame of this request on the driver's session, or null if it never comes. */
    private Recibido esperarSolicitud(Conductor conductor, String solicitudId) throws Exception {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        while (System.nanoTime() < limite) {
            Recibido recibido = conductor.sesion().esperarFrame(TIMEOUT_SEGUNDOS);
            if (recibido == null) {
                return null;
            }
            if (solicitudId.equals(recibido.frame().path("solicitudId").asText(null))) {
                return recibido;
            }
        }
        return null;
    }

    /**
     * Proves the driver's session received none of these requests. A sentinel
     * is sent to the driver through the real PushPort and awaited; a broadcast
     * addressed to this driver would have been published before it. Everything
     * the session received until the sentinel, plus a short grace period for a
     * frame delivered out of order, is inspected.
     */
    private void assertNoRecibio(Conductor conductor, Set<String> solicitudes) throws Exception {
        String marca = UUID.randomUUID().toString();
        pushPort.publicarAUsuario(conductor.usuarioId(), DESTINO_SOLICITUDES,
                Map.of("tipo", "centinela", "marca", marca));

        List<JsonNode> recibidos = new ArrayList<>();
        boolean llegoElCentinela = false;
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        while (!llegoElCentinela && System.nanoTime() < limite) {
            Recibido recibido = conductor.sesion().esperarFrame(1);
            if (recibido == null) {
                continue;
            }
            recibidos.add(recibido.frame());
            llegoElCentinela = marca.equals(recibido.frame().path("marca").asText(null));
        }
        assertTrue(llegoElCentinela,
                "la sesión de " + conductor.email() + " debe seguir recibiendo: sin eso, "
                        + "que no llegue la solicitud no probaría nada");

        Recibido tardio = conductor.sesion().esperarFrameMs(GRACIA_MS);
        while (tardio != null) {
            recibidos.add(tardio.frame());
            tardio = conductor.sesion().esperarFrameMs(GRACIA_MS);
        }

        for (JsonNode frame : recibidos) {
            String solicitudId = frame.path("solicitudId").asText(null);
            assertFalse(solicitudId != null && solicitudes.contains(solicitudId),
                    conductor.email() + " no puede recibir la solicitud y recibió: " + frame);
        }
    }

    // -----------------------------------------------------------------------
    // Fleet state, set directly in the database
    // -----------------------------------------------------------------------

    private UUID unidadDe(String email) {
        UUID usuarioId = usuarioRepository.buscarPorEmail(email)
                .orElseThrow(() -> new AssertionError("no existe el conductor sembrado: " + email))
                .getId();
        return ambulanciaJpaRepository.findFirstByConductorId(usuarioId)
                .orElseThrow(() -> new AssertionError("el conductor sembrado no tiene unidad: " + email))
                .getId();
    }

    /** Available, connected and with signal: the unit can receive requests. */
    private void dejarCandidata(String email) {
        jdbcTemplate.update(
                "UPDATE ambulancias SET estado = ?, conectada = true, sin_senal = false WHERE id = ?",
                EstadoAmbulancia.DISPONIBLE.name(), unidadDe(email));
    }

    private void fijarEstado(String email, EstadoAmbulancia estado) {
        jdbcTemplate.update("UPDATE ambulancias SET estado = ? WHERE id = ?",
                estado.name(), unidadDe(email));
    }

    private void desconectar(String email) {
        jdbcTemplate.update("UPDATE ambulancias SET conectada = false WHERE id = ?", unidadDe(email));
    }

    private void dejarSinSenal(String email) {
        jdbcTemplate.update("UPDATE ambulancias SET sin_senal = true WHERE id = ?", unidadDe(email));
    }

    // -----------------------------------------------------------------------
    // Test infrastructure (same approach as FlotaBroadcastRealtimeTest)
    // -----------------------------------------------------------------------

    /**
     * Confirms every subscription in two steps, because the two registries are
     * updated at different times: the {@link SimpUserRegistry} proves the
     * session's Principal is the driver's user id, and a warm-up frame that
     * round-trips through the real PushPort proves the broker already delivers
     * to that user. Without the second step a broadcast can be dropped in the
     * window between the SUBSCRIBE and the broker registering it, and "the busy
     * driver received nothing" would pass for the wrong reason.
     */
    private void confirmarSuscripciones(Iterable<Conductor> conductores) throws Exception {
        Set<String> usuarios = new HashSet<>();
        conductores.forEach(conductor -> usuarios.add(conductor.usuarioId()));
        esperarRegistroDeUsuarios(usuarios);

        for (Conductor conductor : conductores) {
            SesionStomp sesion = conductor.sesion();
            boolean recibio = false;
            long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS * 2);
            while (!recibio && System.nanoTime() < limite) {
                sesion.drenarRecibidos();
                pushPort.publicarAUsuario(conductor.usuarioId(), DESTINO_SOLICITUDES,
                        Map.of("tipo", "calentamiento-suscripcion"));
                if (sesion.esperarFrame(2) != null) {
                    recibio = true;
                    // A second warm-up may still be on its way: let it land, then drop it.
                    while (sesion.esperarFrameMs(GRACIA_MS) != null) {
                        // drained
                    }
                }
            }
            assertTrue(recibio, "no se pudo confirmar la entrega a " + conductor.email()
                    + "; causa=" + sesion.causaRechazo.get());
        }
    }

    /** Waits until every driver is registered with an active subscription. */
    private void esperarRegistroDeUsuarios(Set<String> usuarios) throws Exception {
        Set<String> pendientes = new HashSet<>(usuarios);
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        while (!pendientes.isEmpty() && System.nanoTime() < limite) {
            pendientes.removeIf(this::suscripcionRegistrada);
            if (!pendientes.isEmpty()) {
                Thread.sleep(50L);
            }
        }
        assertTrue(pendientes.isEmpty(),
                "suscripciones no registradas: " + pendientes
                        + "; usuarios en el registro=" + simpUserRegistry.getUsers().stream()
                                .map(SimpUser::getName).toList());
    }

    private boolean suscripcionRegistrada(String usuarioId) {
        SimpUser usuario = simpUserRegistry.getUser(usuarioId);
        return usuario != null && usuario.getSessions().stream()
                .anyMatch(sesion -> !sesion.getSubscriptions().isEmpty());
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

    /**
     * Test STOMP session: connects, confirms CONNECT with a latch, subscribes
     * and queues every received frame with the instant it arrived. SockJS with a
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

        Recibido esperarFrame(long segundos) throws InterruptedException {
            return recibidos.poll(segundos, TimeUnit.SECONDS);
        }

        Recibido esperarFrameMs(long milisegundos) throws InterruptedException {
            return recibidos.poll(milisegundos, TimeUnit.MILLISECONDS);
        }

        void drenarRecibidos() {
            recibidos.clear();
        }

        void cerrar() {
            for (StompSession.Subscription suscripcion : suscripciones) {
                try {
                    suscripcion.unsubscribe();
                } catch (Exception ignorado) {
                    // Best-effort close: it must not mask the test result.
                }
            }
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
