package co.edu.escuelaing.nexovital.realtime;

import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
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
import org.springframework.http.HttpMethod;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Prueba de integración del canal de tiempo real (diseño US2 D9 y §7). Levanta
 * un servidor real ({@code RANDOM_PORT}), obtiene tokens reales por
 * {@code POST /api/v1/sesiones} y abre dos sesiones STOMP contra
 * {@code ws://localhost:{port}/ws}.
 *
 * <p><b>Desviación obligada (S-1 no es implementable como está escrito).</b> El
 * {@code WebSocketConfig} de producción registra el endpoint con
 * {@code .withSockJS()}, y eso publica el handshake SOLO en la ruta SockJS
 * ({@code /ws/**}). Un upgrade WebSocket nativo a {@code /ws} lo atiende
 * {@code SockJsHttpRequestHandler} y responde 400 (verificado: el
 * {@code WebSocketHandlerMapping} solo mapea {@code [/ws/**]}). Sin tocar
 * producción, la única forma de alcanzar el interceptor es el cliente SockJS.
 * Se usa {@link SockJsClient} con un único {@link WebSocketTransport}: el
 * transporte real sigue siendo WebSocket nativo (el primero que SockJS intenta),
 * y es el mismo transporte que usa el front. Así, S2/S3 validan el rechazo del
 * {@code CONNECT} del interceptor, no un handshake fallido.
 *
 * <p>Cubre los casos que hoy tienen productor real: S1 (dos sesiones reciben un
 * reporte de emergencia real y su latencia es &lt; 1 s), S2/S3 (el CONNECT sin
 * token o con token inválido es rechazado), S4 (un cliente tardío ve el estado
 * por REST) y S5 (el canal entrega a {@code /topic/map.events} usando el
 * {@link PushPort} nuestro). Los casos T2/T3/T7/T8 dependen de productores de
 * elementos de mapa que no existen (riesgo R1) y quedan bloqueados en el ODD.
 *
 * <p>Todo timeout es explícito y acotado, y cada cliente se cierra en
 * {@link #cerrarTodo()}: un cliente STOMP sin cerrar cuelga la suite.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class CanalTiempoRealDosSesionesTest {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    /** Destino ya declarado en el contrato para una emergencia nueva. */
    private static final String DESTINO_EMERGENCIAS = "/topic/emergencias";
    /** Destino del mapa declarado en el system-design (diseño US2 D3). */
    private static final String DESTINO_MAPA = "/topic/map.events";

    /** Tope de espera para conexión, suscripción y frames: acotado en segundos. */
    private static final long TIMEOUT_SEGUNDOS = 10;
    /** Criterio de la historia (D9): el frame debe llegar en menos de 1 s. */
    private static final long LATENCIA_MAXIMA_NANOS = 1_000_000_000L;

    /** Punto dentro del polígono de Suba sembrado (mismo que EmergenciasHttpTest). */
    private static final double SUBA_LAT = 4.73d;
    private static final double SUBA_LNG = -74.08d;

    @LocalServerPort
    private int puerto;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PushPort pushPort;

    /**
     * Planificador del cliente STOMP (heartbeats y timeouts de receipt). Es
     * propio de la prueba y se apaga en {@link #cerrarTodo()}: uno del cliente
     * por defecto no se cerraría y dejaría hilos vivos.
     */
    private ThreadPoolTaskScheduler planificador;
    private final List<SesionStomp> sesiones = new ArrayList<>();

    @BeforeEach
    void prepararPlanificador() {
        planificador = new ThreadPoolTaskScheduler();
        planificador.setPoolSize(2);
        planificador.setThreadNamePrefix("stomp-test-");
        planificador.setDaemon(true);
        planificador.initialize();
    }

    @AfterEach
    void cerrarTodo() {
        for (SesionStomp sesion : sesiones) {
            sesion.cerrar();
        }
        sesiones.clear();
        planificador.shutdown();
    }

    // -----------------------------------------------------------------------
    // S1 — Dos sesiones + productor real (POST /emergencias) + latencia (T1)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S1: dos sesiones autenticadas reciben la emergencia real con el mismo id, latencia < 1 s")
    void s1_dosSesionesRecibenLaEmergenciaReal() throws Exception {
        String tokenCiudadano = iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD);
        String tokenRangel = iniciarSesion(RANGEL, RANGEL_PASSWORD);

        // Dos usuarios distintos, ambos suscritos al mismo destino del contrato.
        SesionStomp sesionCiudadano = abrirSesion(tokenCiudadano, DESTINO_EMERGENCIAS);
        SesionStomp sesionRangel = abrirSesion(tokenRangel, DESTINO_EMERGENCIAS);
        confirmarSuscripciones(DESTINO_EMERGENCIAS, sesionCiudadano, sesionRangel);

        String descripcion = "propagacion-dos-sesiones-" + UUID.randomUUID();

        // El disparo: un POST real (transacción real + AFTER_COMMIT real).
        long disparoNanos = System.nanoTime();
        ResponseEntity<String> respuesta = reportarEmergencia(tokenCiudadano, descripcion);
        assertEquals(HttpStatus.CREATED, respuesta.getStatusCode(),
                "el POST real de la emergencia debe responder 201");
        String id = objectMapper.readTree(respuesta.getBody()).get("id").asText();

        // AMBAS sesiones reciben el frame, con el mismo id que devolvió el POST.
        long recepcionCiudadanoNanos = System.nanoTime();
        JsonNode frameCiudadano = frameConId(sesionCiudadano, id, "la sesión del ciudadano");
        assertNotNull(frameCiudadano, "la sesión del ciudadano debe recibir la emergencia");
        long recepcionRangelNanos = System.nanoTime();
        JsonNode frameRangel = frameConId(sesionRangel, id, "la sesión de rangel");
        assertNotNull(frameRangel, "la sesión de rangel debe recibir la emergencia");

        assertEquals(id, frameCiudadano.get("id").asText());
        assertEquals(id, frameRangel.get("id").asText());
        assertEquals(descripcion, frameCiudadano.get("descripcion").asText(),
                "el frame debe traer la descripción reportada, no otro evento");

        // Latencia medida con nanoTime, afirmada como cota (D9: < 1 s).
        assertTrue(recepcionCiudadanoNanos - disparoNanos < LATENCIA_MAXIMA_NANOS,
                "la latencia del ciudadano debe ser < 1 s");
        assertTrue(recepcionRangelNanos - disparoNanos < LATENCIA_MAXIMA_NANOS,
                "la latencia de rangel debe ser < 1 s");
    }

    // -----------------------------------------------------------------------
    // S2 — CONNECT sin token → rechazado (T4, diseño S-3)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S2: CONNECT sin cabecera Authorization es rechazado y la sesión no se abre (T4)")
    void s2_connectSinTokenEsRechazado() throws Exception {
        intentarConexionRechazada(null, "sin token");
    }

    // -----------------------------------------------------------------------
    // S3 — CONNECT con token inválido → rechazado (T5, diseño S-3)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S3: CONNECT con un Bearer inválido es rechazado y la sesión no se abre (T5)")
    void s3_connectConTokenInvalidoEsRechazado() throws Exception {
        intentarConexionRechazada("token-basura", "con token inválido");
    }

    // -----------------------------------------------------------------------
    // S4 — Ciudadano que llega tarde ve el estado por REST (T6 adaptado)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S4: un cliente tardío con un token nuevo ve por REST el reporte ya creado (T6)")
    void s4_clienteTardioVeElEstadoPorRest() throws Exception {
        String tokenQueReporta = iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD);
        String descripcion = "visible-para-cliente-tardio-" + UUID.randomUUID();

        ResponseEntity<String> alta = reportarEmergencia(tokenQueReporta, descripcion);
        assertEquals(HttpStatus.CREATED, alta.getStatusCode());
        String id = objectMapper.readTree(alta.getBody()).get("id").asText();

        // Un token NUEVO (otra sesión, el que llega tarde) y el snapshot REST.
        String tokenTardio = iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD);
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(tokenTardio);
        ResponseEntity<String> listado = restTemplate.exchange(
                "/api/v1/emergencias", HttpMethod.GET, new HttpEntity<>(headers), String.class);

        assertEquals(HttpStatus.OK, listado.getStatusCode(), "GET /emergencias debe responder 200");
        JsonNode emergencias = objectMapper.readTree(listado.getBody());
        assertTrue(emergencias.isArray(), "el GET debe devolver una lista JSON");
        assertTrue(contieneId(emergencias, id),
                "el snapshot REST debe incluir el reporte ya creado: " + id);
    }

    // -----------------------------------------------------------------------
    // S5 — El canal entrega a /topic/map.events (T1 como prueba de CANAL, S-5)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S5: el PushPort entrega por el canal a /topic/map.events a las dos sesiones (prueba de canal)")
    void s5_elCanalEntregaAlDestinoDelMapa() throws Exception {
        // PRUEBA DE CANAL, no de una mutación de mapa: no existe productor real
        // de elementos de mapa (riesgo R1), así que se publica por el PushPort
        // nuestro (PushPortPublicadorAdapter -> PushFanOutAdapter -> broker).
        String tokenCiudadano = iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD);
        String tokenRangel = iniciarSesion(RANGEL, RANGEL_PASSWORD);

        SesionStomp sesionCiudadano = abrirSesion(tokenCiudadano, DESTINO_MAPA);
        SesionStomp sesionRangel = abrirSesion(tokenRangel, DESTINO_MAPA);
        confirmarSuscripciones(DESTINO_MAPA, sesionCiudadano, sesionRangel);

        String idElemento = "prueba-canal-" + UUID.randomUUID();
        Map<String, Object> payload = Map.of(
                "type", "mapa.elemento.upsert",
                "clase", "ZONA",
                "id", idElemento);

        pushPort.publicar(DESTINO_MAPA, payload);

        JsonNode frameCiudadano = frameDe(sesionCiudadano, "la sesión del ciudadano");
        JsonNode frameRangel = frameDe(sesionRangel, "la sesión de rangel");

        assertNotNull(frameCiudadano, "la sesión del ciudadano debe recibir el evento de canal");
        assertNotNull(frameRangel, "la sesión de rangel debe recibir el evento de canal");
        assertEquals("mapa.elemento.upsert", frameCiudadano.get("type").asText());
        assertEquals(idElemento, frameCiudadano.get("id").asText());
        assertEquals(idElemento, frameRangel.get("id").asText());
    }

    // -----------------------------------------------------------------------
    // Infraestructura de prueba
    // -----------------------------------------------------------------------

    /** Abre una sesión autenticada y la deja suscrita al destino. */
    private SesionStomp abrirSesion(String token, String destino) throws Exception {
        SesionStomp sesion = new SesionStomp(planificador);
        sesiones.add(sesion);
        sesion.conectar(urlWs(), token);
        sesion.suscribir(destino);
        return sesion;
    }

    /**
     * Confirma que el broker ya registró las suscripciones. El simple broker de
     * Spring NO emite RECEIPT para SUBSCRIBE (solo para DISCONNECT), así que la
     * única señal fiable es que llegue un mensaje publicado DESPUÉS del
     * SUBSCRIBE: se reintenta con una marca de calentamiento única hasta que
     * alcance a todas las sesiones. Sin esta confirmación, el disparo real podría
     * perderse por la ventana entre el SUBSCRIBE y su registro (diseño R5).
     */
    private void confirmarSuscripciones(String destino, SesionStomp... sesiones)
            throws Exception {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        while (System.nanoTime() < limite) {
            for (SesionStomp sesion : sesiones) {
                sesion.drenarRecibidos();
            }
            // La marca viaja por el PushPort real: mismo camino que el evento.
            pushPort.publicar(destino, Map.of("tipo", "calentamiento-suscripcion"));

            int recibieron = 0;
            for (SesionStomp sesion : sesiones) {
                if (sesion.esperarFrame(1) != null) {
                    recibieron++;
                }
            }
            if (recibieron == sesiones.length) {
                for (SesionStomp sesion : sesiones) {
                    sesion.drenarRecibidos();
                }
                return;
            }
        }
        StringBuilder causas = new StringBuilder();
        for (SesionStomp sesion : sesiones) {
            causas.append('[').append(sesion.causaRechazo.get()).append(']');
        }
        fail("no se pudo confirmar que las suscripciones a " + destino
                + " estén activas; causas=" + causas);
    }

    /**
     * Intenta un CONNECT que el interceptor debe rechazar. El criterio es el
     * latch de fallo (el rechazo OCURRIÓ), no una espera que expira: una espera
     * pasiva podría dar un falso verde.
     */
    private void intentarConexionRechazada(String token, String motivo) throws Exception {
        SesionStomp sesion = new SesionStomp(planificador);
        sesiones.add(sesion);
        sesion.conectar(urlWs(), token);

        assertTrue(sesion.rechazado.await(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS),
                "el CONNECT " + motivo + " debe ser rechazado por el interceptor");
        assertNotNull(sesion.causaRechazo.get(),
                "el rechazo del CONNECT " + motivo + " debe traer una causa");
        assertEquals(1, sesion.conectado.getCount(),
                "la sesión NO debe abrirse: no debe llegar el CONNECTED " + motivo);
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

        assertEquals(HttpStatus.OK, respuesta.getStatusCode(),
                "el login real debe responder 200 para " + email);
        return objectMapper.readTree(respuesta.getBody()).get("token").asText();
    }

    private ResponseEntity<String> reportarEmergencia(String token, String descripcion) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        Map<String, Object> cuerpo = Map.of(
                "ubicacion", Map.of("lat", SUBA_LAT, "lng", SUBA_LNG),
                "nivel", "ALTO",
                "descripcion", descripcion);
        return restTemplate.postForEntity(
                "/api/v1/emergencias", new HttpEntity<>(cuerpo, headers), String.class);
    }

    /**
     * Espera y devuelve el frame cuyo {@code id} coincide; descarta cualquier
     * otro frame que hubiera quedado en la cola. Es determinista porque en S1 el
     * destino solo transporta la emergencia reportada.
     */
    private JsonNode frameConId(SesionStomp sesion, String id, String descripcionSesion)
            throws Exception {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        while (System.nanoTime() < limite) {
            JsonNode frame = frameDe(sesion, descripcionSesion);
            if (frame == null) {
                return null;
            }
            if (frame.hasNonNull("id") && id.equals(frame.get("id").asText())) {
                return frame;
            }
        }
        return null;
    }

    /** Espera un frame ya deserializado; falla si el timeout vence. */
    private JsonNode frameDe(SesionStomp sesion, String descripcionSesion) throws Exception {
        JsonNode frame = sesion.esperarFrame(TIMEOUT_SEGUNDOS);
        assertNotNull(frame, "la " + descripcionSesion + " no recibió ningún frame a tiempo");
        return frame;
    }

    private static boolean contieneId(JsonNode emergencias, String id) {
        for (JsonNode emergencia : emergencias) {
            if (id.equals(emergencia.get("id").asText())) {
                return true;
            }
        }
        return false;
    }

    /**
     * Sesión STOMP de prueba: conecta, confirma el CONNECT con un latch (nunca
     * con {@code Thread.sleep}), se suscribe al destino y acumula los frames
     * recibidos en una cola. La activación de la suscripción la confirma el test
     * con {@code confirmarSuscripciones} (el simple broker no emite RECEIPT).
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
            // El endpoint es SockJS-only (ver javadoc de la clase): se usa el
            // cliente SockJS con un único transporte, el WebSocket nativo.
            List<Transport> transportes =
                    List.of(new WebSocketTransport(new StandardWebSocketClient()));
            this.cliente = new WebSocketStompClient(new SockJsClient(transportes));
            // El frame llega con content-type application/json. El converter por
            // defecto (SimpleMessageConverter) NO convierte byte[] -> String, y
            // StringMessageConverter no soporta application/json. Jackson sí:
            // el handler pide JsonNode y recibe el cuerpo ya deserializado.
            this.cliente.setMessageConverter(new MappingJackson2MessageConverter());
            this.cliente.setTaskScheduler(planificador);
            // SockJsClient es un Lifecycle: se arranca y el cierre lo detiene.
            this.cliente.start();
        }

        /** Inicia el CONNECT; no bloquea: cada caso decide si espera éxito o rechazo. */
        void conectar(String url, String token) {
            if (token != null) {
                connectHeaders.add(CABECERA_AUTHORIZATION, "Bearer " + token);
            }
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
            // El resultado se observa por los latches; el futuro no se bloquea.
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

            StompSession.Subscription suscripcion = sesion.subscribe(destino, recibidor);
            suscripciones.add(suscripcion);
        }

        /** Espera un frame hasta el timeout; {@code null} si no llega. */
        JsonNode esperarFrame(long segundos) throws InterruptedException {
            return recibidos.poll(segundos, TimeUnit.SECONDS);
        }

        /** Vacía la cola de frames (se usa antes y después del calentamiento). */
        void drenarRecibidos() {
            recibidos.clear();
        }

        private void registrarRechazo(Throwable exception) {
            causaRechazo.compareAndSet(null, exception);
            rechazado.countDown();
        }

        /** Cierra suscripciones y sesión; deja el cliente detenido. */
        void cerrar() {
            for (StompSession.Subscription suscripcion : suscripciones) {
                try {
                    suscripcion.unsubscribe();
                } catch (Exception ignorado) {
                    // El cierre es best-effort: no debe enmascarar el resultado.
                }
            }
            try {
                if (sesion != null && sesion.isConnected()) {
                    sesion.disconnect();
                }
            } catch (Exception ignorado) {
                // Idem: la conexión puede haberse cerrado ya por el rechazo.
            }
            try {
                cliente.stop();
            } catch (Exception ignorado) {
                // Idem.
            }
        }
    }
}
