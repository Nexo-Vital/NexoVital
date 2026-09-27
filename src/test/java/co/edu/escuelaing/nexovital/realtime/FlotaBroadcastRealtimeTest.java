package co.edu.escuelaing.nexovital.realtime;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end proof of AC1 and D-F1: a real {@code POST /solicitudes} is
 * broadcast to EVERY notified unit, each one recovering its OWN copy on
 * {@code /user/queue/solicitudes}.
 *
 * <p>This is the discriminating test for the round-robin bug: if the producer
 * published once to the shared {@code /queue/solicitudes}, Spring's simple
 * broker would deliver it to only ONE of the N subscribers and the other
 * sessions would never see it. With user destinations every session receives
 * its copy.
 *
 * <p>Five real drivers log in, open a SockJS/STOMP session and subscribe. The
 * fleet is reset to DISPONIBLE first so the seeded five units (D-F6) are all
 * notified. All timeouts are explicit and every client is closed afterwards.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class FlotaBroadcastRealtimeTest {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String PASSWORD_CONDUCTOR = "conductor123";
    private static final List<String> CONDUCTORES = List.of(
            "conductor1@nexovital.co",
            "conductor2@nexovital.co",
            "conductor3@nexovital.co",
            "conductor4@nexovital.co",
            "conductor5@nexovital.co");

    private static final String ZONA = "Suba";
    /** The module publishes to this destination; the gateway prefixes the user. */
    private static final String DESTINO_SOLICITUDES = "/queue/solicitudes";
    /** D-F1: the driver session subscribes to its OWN user destination. */
    private static final String DESTINO_SOLICITUDES_USUARIO = "/user/queue/solicitudes";
    private static final long TIMEOUT_SEGUNDOS = 10;

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
    private SimpUserRegistry simpUserRegistry;

    private ThreadPoolTaskScheduler planificador;
    private final List<SesionStomp> sesiones = new ArrayList<>();

    @BeforeEach
    void prepararPlanificadorYFlota() {
        planificador = new ThreadPoolTaskScheduler();
        planificador.setPoolSize(4);
        planificador.setThreadNamePrefix("stomp-flota-test-");
        planificador.setDaemon(true);
        planificador.initialize();

        ambulanciaJpaRepository.findAll().forEach(entidad -> {
            if (entidad.getEstado() != EstadoAmbulancia.DISPONIBLE) {
                entidad.setEstado(EstadoAmbulancia.DISPONIBLE);
                ambulanciaJpaRepository.save(entidad);
            }
        });
    }

    @AfterEach
    void cerrarTodo() {
        for (SesionStomp sesion : sesiones) {
            sesion.cerrar();
        }
        sesiones.clear();
        planificador.shutdown();
    }

    @Test
    @DisplayName("AC1/D-F1: el broadcast real llega a CADA conductor en su destino de usuario")
    void ac1_elBroadcastLlegaATodosLosConductores() throws Exception {
        String tokenCiudadano = iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD);

        Map<String, SesionStomp> porUsuario = new LinkedHashMap<>();
        for (String email : CONDUCTORES) {
            String token = iniciarSesion(email, PASSWORD_CONDUCTOR);
            SesionStomp sesion = abrirSesion(token, DESTINO_SOLICITUDES_USUARIO);
            String usuarioId = usuarioRepository.buscarPorEmail(email)
                    .orElseThrow(() -> new AssertionError("seeded driver not found: " + email))
                    .getId().toString();
            porUsuario.put(usuarioId, sesion);
        }
        confirmarSuscripciones(porUsuario);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(tokenCiudadano);
        Map<String, Object> cuerpo = Map.of(
                "emergenciaId", UUID.randomUUID().toString(),
                "centroAyudaId", UUID.randomUUID().toString(),
                "zonaId", ZONA);
        ResponseEntity<String> respuesta = restTemplate.postForEntity(
                "/api/v1/solicitudes", new HttpEntity<>(cuerpo, headers), String.class);

        assertEquals(HttpStatus.CREATED, respuesta.getStatusCode(), "el POST real debe responder 201");
        JsonNode creada = objectMapper.readTree(respuesta.getBody());
        assertEquals(5, creada.get("ambulanciasNotificadas").size(),
                "el broadcast debe notificar a las cinco ambulancias sembradas de Suba");
        String solicitudId = creada.get("id").asText();

        for (Map.Entry<String, SesionStomp> entry : porUsuario.entrySet()) {
            JsonNode frame = esperarBroadcast(entry.getValue());
            assertNotNull(frame,
                    "el conductor " + entry.getKey() + " debe recibir su copia del broadcast en su destino de usuario");
            assertEquals(solicitudId, frame.get("solicitudId").asText());
            assertEquals("PENDIENTE", frame.get("estado").asText());
            assertEquals(ZONA, frame.get("zonaId").asText());
        }
    }

    // -----------------------------------------------------------------------
    // Test infrastructure
    // -----------------------------------------------------------------------

    private SesionStomp abrirSesion(String token, String destino) throws Exception {
        SesionStomp sesion = new SesionStomp(planificador);
        sesiones.add(sesion);
        sesion.conectar(urlWs(), token);
        sesion.suscribir(destino);
        return sesion;
    }

    /**
     * Confirms every subscription in two steps, because the two registries are
     * updated at different times:
     * <ol>
     *   <li>the {@link SimpUserRegistry} proves the session's Principal name is
     *       the driver user id (the key {@code convertAndSendToUser} needs);</li>
     *   <li>the broker's own subscription registry is updated ASYNCHRONOUSLY, so
     *       the only reliable proof it is ready is a warm-up frame that
     *       round-trips through the real PushPort to that user's destination.
     *       This also confirms {@code /user/queue/solicitudes} resolves.</li>
     * </ol>
     * Without step 2 the real broadcast can be dropped in the window between the
     * SUBSCRIBE and the broker registering the subscription.
     */
    private void confirmarSuscripciones(Map<String, SesionStomp> porUsuario) throws Exception {
        esperarRegistroDeUsuarios(porUsuario.keySet());

        for (Map.Entry<String, SesionStomp> entry : porUsuario.entrySet()) {
            String usuarioId = entry.getKey();
            SesionStomp sesion = entry.getValue();
            boolean recibio = false;
            long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS * 2);
            while (!recibio && System.nanoTime() < limite) {
                sesion.drenarRecibidos();
                pushPort.publicarAUsuario(usuarioId, DESTINO_SOLICITUDES,
                        Map.of("tipo", "calentamiento-suscripcion"));
                if (sesion.esperarFrame(2) != null) {
                    recibio = true;
                    sesion.drenarRecibidos();
                }
            }
            assertTrue(recibio,
                    "no se pudo confirmar la entrega al usuario " + usuarioId
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

    /** Waits for the broadcast frame (draining any leftover warm-up). */
    private JsonNode esperarBroadcast(SesionStomp sesion) throws Exception {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        while (System.nanoTime() < limite) {
            JsonNode frame = sesion.esperarFrame(TIMEOUT_SEGUNDOS);
            if (frame == null) {
                return null;
            }
            if (frame.hasNonNull("solicitudId")) {
                return frame;
            }
        }
        return null;
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
     * and queues every received frame. SockJS with a single WebSocket transport,
     * which is what the front uses.
     */
    private static final class SesionStomp {

        private static final String CABECERA_AUTHORIZATION = "Authorization";

        private final WebSocketStompClient cliente;
        private final StompHeaders connectHeaders = new StompHeaders();
        private final CountDownLatch conectado = new CountDownLatch(1);
        private final CountDownLatch rechazado = new CountDownLatch(1);
        private final AtomicReference<Throwable> causaRechazo = new AtomicReference<>();
        private final BlockingQueue<JsonNode> recibidos = new LinkedBlockingQueue<>();
        private final List<StompSession.Subscription> suscripciones = new ArrayList<>();

        private StompSession sesion;

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
                    registrarRechazo(exception);
                }

                @Override
                public void handleTransportError(StompSession session, Throwable exception) {
                    registrarRechazo(exception);
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
                    recibidos.add((JsonNode) payload);
                }
            };
            suscripciones.add(sesion.subscribe(destino, recibidor));
        }

        JsonNode esperarFrame(long segundos) throws InterruptedException {
            return recibidos.poll(segundos, TimeUnit.SECONDS);
        }

        void drenarRecibidos() {
            recibidos.clear();
        }

        private void registrarRechazo(Throwable exception) {
            causaRechazo.compareAndSet(null, exception);
            rechazado.countDown();
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
