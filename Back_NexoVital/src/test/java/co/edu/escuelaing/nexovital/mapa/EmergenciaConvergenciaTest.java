package co.edu.escuelaing.nexovital.mapa;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out.EmergenciaJpaRepository;
import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.event.EventListener;
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
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Prueba el <b>AC2 de EP-02.F1.US4 (Azure 185)</b>, que había quedado sin
 * probar: <i>"Dado dos actualizaciones simultáneas del mismo elemento, cuando el
 * sistema las aplica, entonces queda un único estado final para todos"</i>.
 *
 * <p>El AC tiene tres partes y el test las cubre con dos casos:
 * <ol>
 *   <li><b>(A) por HTTP</b>: N {@code PATCH /api/v1/emergencias/{id}} reales y
 *       concurrentes (uno por usuario autorizado, con pares {@code (estado,
 *       nivel)} distintos) convergen a <b>exactamente uno</b> de los pares
 *       enviados —nunca a un híbrido— y el resultado es estable entre dos
 *       lecturas. Prueba "no hay híbrido" y "es estable".</li>
 *   <li><b>(B) realtime</b>: una sesión STOMP autenticada, suscrita a
 *       {@code /topic/emergencias} y confirmada antes de disparar, recibe los
 *       eventos de la misma tormenta y termina en el <b>mismo</b> estado que la
 *       base. Prueba "es el mismo para todos", que es el corazón de "para
 *       todos". Sin este caso, una base correcta con clientes desincronizados
 *       pasaría el AC.</li>
 * </ol>
 *
 * <p><b>Por qué (B) debería cumplirse y qué reveló la prueba.</b> El listener
 * {@code @TransactionalEventListener(AFTER_COMMIT)} corre en el hilo que
 * commitea, después del commit, y el push al broker es síncrono en ese mismo
 * hilo: el orden de EMISIÓN sigue al orden de commit. Pero el broker simple de
 * Spring entrega a los suscriptores por el {@code clientOutboundChannel}, que es
 * asíncrono y —con {@code preservePublishOrder} en su valor por defecto
 * ({@code false})— NO garantiza conservar el orden de publicación a través de
 * hilos. Resultado: el cliente puede recibir los dos eventos invertidos y quedar
 * en el estado perdedor mientras la base tiene el ganador. El hallazgo está
 * aislado por {@link ObservadorDeEmision}: en las corridas que fallan, <b>el
 * último evento emitido sí coincide con la base</b> y el cliente los recibe al
 * revés, así que el reordenamiento es de la ENTREGA, no de la emisión. Es un
 * HALLAZGO de producción, no un test que se deba ablandar.
 *
 * <p><b>Concurrencia real.</b> Se sigue la mecánica de
 * {@code IntentosConcurrentesTest}: {@code ExecutorService}, una puerta de
 * salida simultánea ({@code CountDownLatch}) y {@code Future}s. Además se mide
 * la ventana temporal de cada petición y se afirma que <b>se solapan</b>: si las
 * peticiones se serializaran, el caso no probaría el AC.
 *
 * <p><b>Por qué HTTP con el cliente del JDK y no {@code TestRestTemplate}.</b>
 * El endpoint es un {@code PATCH} y en el classpath de test no hay
 * Apache/OkHttp: {@code TestRestTemplate} caería en
 * {@code SimpleClientHttpRequestFactory}, que usa {@code HttpURLConnection} y
 * este rechaza {@code PATCH} ({@code ProtocolException: Invalid HTTP method:
 * PATCH}, verificado en JDK 21). El {@link HttpClient} del JDK sí lo soporta y
 * es thread-safe, así que sostiene la concurrencia real.
 *
 * <p>La clase no reutiliza los helpers de {@code CanalTiempoRealDosSesionesTest}
 * porque {@code SesionStomp} es una clase interna {@code private static} de ese
 * test: no es importable. Se copia el enfoque (cliente SockJS con transporte
 * WebSocket, latches —nunca {@code Thread.sleep}— y cola de frames), que es lo
 * que el ODD autoriza.
 *
 * <p>La H2 de test se comparte entre todos los contextos del JVM
 * ({@code DB_CLOSE_DELAY=-1}), así que lo que crea este test se borra en
 * {@link #cerrarYLimpiar()}: otros tests cuentan filas.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import(EmergenciaConvergenciaTest.ObservadorDeEmisionConfig.class)
class EmergenciaConvergenciaTest {

    /**
     * Orden de emisión observado, como evidencia del hallazgo de (B): se registra
     * "id|estado/nivel" por cada payload de emergencia que el hilo que commitea
     * entrega al {@code PushPort}. Permite separar "reordenó la emisión" de
     * "reordenó la entrega del broker" (ver el Javadoc de la clase).
     */
    static final List<String> EMISION = new CopyOnWriteArrayList<>();

    /** Config de test que añade {@link ObservadorDeEmision} al contexto real. */
    @TestConfiguration
    static class ObservadorDeEmisionConfig {
        @Bean
        ObservadorDeEmision observadorDeEmision() {
            return new ObservadorDeEmision();
        }
    }

    /**
     * Escucha los {@code PushMessage} reales (el evento interno que el adaptador
     * del {@code PushPort} publica) para registrar el orden de emisión. NO
     * reemplaza al adaptador real: solo observa.
     */
    static class ObservadorDeEmision {
        @EventListener
        public void alPublicar(PushMessage mensaje) {
            if (mensaje.payload() instanceof Emergencia emergencia) {
                EMISION.add(emergencia.getId() + "|" + emergencia.getEstado() + "/" + emergencia.getNivel());
            }
        }
    }

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    /** ADMIN_CENTRO_AYUDA (uno de los dos usuarios autorizados a hacer PATCH). */
    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";
    /** El otro ADMIN_CENTRO_AYUDA sembrado: da un token autorizado DISTINTO. */
    private static final String CENTRO = "centro@nexovital.co";
    private static final String CENTRO_PASSWORD = "centro123";

    /** Destino ya declarado en el contrato para una emergencia (US2/US4). */
    private static final String DESTINO_EMERGENCIAS = "/topic/emergencias";

    private static final double SUBA_LAT = 4.73d;
    private static final double SUBA_LNG = -74.08d;

    /** Tope de espera para HTTP, conexión, suscripción y frames. Acotado. */
    private static final long TIMEOUT_SEGUNDOS = 10L;

    /**
     * Los dos pares del contrato que se envían a la vez. Son deliberadamente
     * "cruzados": el híbrido {@code (EN_ATENCION, BAJO)} o {@code (RESUELTA,
     * ALTO)} no pertenece a este conjunto y debe hacer fallar el test.
     */
    private static final Par PAR_RANGEL = new Par("EN_ATENCION", "ALTO");
    private static final Par PAR_CENTRO = new Par("RESUELTA", "BAJO");

    @LocalServerPort
    private int puerto;

    @Autowired
    private ObjectMapper objectMapper;

    /** PushPort REAL (no el doble de test): hace falta para el calentamiento de la sesión. */
    @Autowired
    private PushPort pushPort;

    /** Repositorio real, solo para leer el estado final de la base y limpiar la fila. */
    @Autowired
    private EmergenciaJpaRepository emergenciaJpaRepository;

    private HttpClient http;
    private ThreadPoolTaskScheduler planificador;
    private SesionStomp sesion;
    private String idCreado;

    @BeforeEach
    void preparar() {
        http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        planificador = new ThreadPoolTaskScheduler();
        planificador.setPoolSize(2);
        planificador.setThreadNamePrefix("stomp-convergencia-");
        planificador.setDaemon(true);
        planificador.initialize();
    }

    /**
     * Cierra SIEMPRE la sesión STOMP y el planificador (que no cuelgue la suite)
     * y borra la emergencia creada (la H2 es compartida y otros tests cuentan
     * filas). Corre aunque el test falle.
     */
    @AfterEach
    void cerrarYLimpiar() {
        try {
            if (sesion != null) {
                sesion.cerrar();
                sesion = null;
            }
        } finally {
            if (planificador != null) {
                planificador.shutdown();
            }
            if (idCreado != null) {
                UUID id = UUID.fromString(idCreado);
                emergenciaJpaRepository.findById(id).ifPresent(emergenciaJpaRepository::delete);
                idCreado = null;
            }
        }
    }

    // -----------------------------------------------------------------------
    // (A) Convergencia por HTTP: no hay híbrido y el estado es estable
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC2 (A): PATCH concurrentes convergen a uno de los pares enviados, sin híbrido, y es estable")
    void a_convergenciaPorHttp() throws Exception {
        String tokenCiudadano = iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD);
        String tokenRangel = iniciarSesion(RANGEL, RANGEL_PASSWORD);
        String tokenCentro = iniciarSesion(CENTRO, CENTRO_PASSWORD);

        idCreado = reportarEmergencia(tokenCiudadano, "convergencia-http-" + UUID.randomUUID());

        // Dos usuarios autorizados distintos, cada uno con su token y su par.
        List<ParPatch> pares = List.of(
                new ParPatch(tokenRangel, PAR_RANGEL),
                new ParPatch(tokenCentro, PAR_CENTRO));

        List<RespuestaPatch> respuestas = dispararPatchesConcurrentes(idCreado, pares);

        // (1) Los N PATCH concurrentes confirman la escritura.
        for (RespuestaPatch respuesta : respuestas) {
            assertEquals(200, respuesta.status(),
                    "cada PATCH concurrente debe responder 200; cuerpo=" + respuesta.cuerpo());
        }

        // Concurrencia real: las ventanas de las peticiones se solapan.
        afirmarVentanasSolapadas(respuestas);

        // (2) El estado final es EXACTAMENTE uno de los pares enviados.
        Par finalBase = leerParPorGet(tokenCiudadano, idCreado);
        afirmarUnoDeLosEnviadosSinHibrido(finalBase, pares);

        // (3) Es estable: dos lecturas seguidas devuelven lo mismo.
        Par segundaLectura = leerParPorGet(tokenCiudadano, idCreado);
        assertEquals(finalBase, segundaLectura,
                "dos lecturas seguidas deben devolver el mismo estado (convergencia estable)");
    }

    // -----------------------------------------------------------------------
    // (B) El mismo estado para todos: la sesión STOMP termina como la base
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC2 (B): una sesión STOMP real termina en el mismo estado que la base tras la tormenta de PATCH")
    void b_mismoEstadoParaTodosPorRealtime() throws Exception {
        String tokenCiudadano = iniciarSesion(CIUDADANO, CIUDADANO_PASSWORD);
        String tokenRangel = iniciarSesion(RANGEL, RANGEL_PASSWORD);
        String tokenCentro = iniciarSesion(CENTRO, CENTRO_PASSWORD);

        // La emergencia se reporta ANTES de suscribirse: el broker simple no
        // retiene, así que el único frame con este id que verá el cliente es el
        // que emiten los PATCH (el del POST ya pasó cuando la sesión no existía).
        idCreado = reportarEmergencia(tokenCiudadano, "convergencia-realtime-" + UUID.randomUUID());

        // Sesión autenticada, suscrita y CONFIRMADA antes de disparar nada.
        sesion = new SesionStomp(planificador);
        sesion.conectar(urlWs(), tokenCiudadano);
        sesion.suscribir(DESTINO_EMERGENCIAS);
        confirmarSuscripcion(DESTINO_EMERGENCIAS, sesion);

        List<ParPatch> pares = List.of(
                new ParPatch(tokenRangel, PAR_RANGEL),
                new ParPatch(tokenCentro, PAR_CENTRO));

        EMISION.clear();
        List<RespuestaPatch> respuestas = dispararPatchesConcurrentes(idCreado, pares);
        for (RespuestaPatch respuesta : respuestas) {
            assertEquals(200, respuesta.status(),
                    "cada PATCH concurrente debe responder 200; cuerpo=" + respuesta.cuerpo());
        }

        // Fuente de verdad: el estado final persistido en la base.
        Par parBase = leerParDeLaBase(idCreado);

        // El cliente aplica EN ORDEN los eventos recibidos para su id (cada evento
        // lleva el agregado completo, el front hace UPSERT por id); el último es su
        // estado final. Debe haber un evento por cada PATCH confirmado.
        List<JsonNode> frames = sesion.framesConId(idCreado, pares.size(), TIMEOUT_SEGUNDOS);
        assertEquals(pares.size(), frames.size(),
                "el cliente debe recibir un evento por cada PATCH confirmado; recibidos=" + frames.size());
        Par parCliente = parDe(frames.get(frames.size() - 1));

        List<String> ordenEmision = EMISION.stream()
                .filter(entrada -> entrada.startsWith(idCreado + "|"))
                .toList();
        List<String> ordenCliente = frames.stream()
                .map(frame -> frame.path("estado").asText() + "/" + frame.path("nivel").asText())
                .toList();

        assertEquals(parBase, parCliente,
                "el último estado que ve el cliente debe coincidir con el estado final de la base"
                        + " (eso es 'un único estado final para todos'): base=" + parBase
                        + ", cliente=" + parCliente
                        + " | orden de emisión (hilo que commitea)=" + ordenEmision
                        + " | orden recibido por el cliente=" + ordenCliente);
    }

    // -----------------------------------------------------------------------
    // Mecánica de concurrencia (patrón del repo)
    // -----------------------------------------------------------------------

    /**
     * Dispara un PATCH por cada {@link ParPatch} (un hilo cada uno), todos
     * liberados a la vez por una puerta de salida ({@code CountDownLatch}), y
     * devuelve sus respuestas. Misma mecánica que {@code IntentosConcurrentesTest}
     * (allí {@code CyclicBarrier}; acá el latch cumple el mismo rol de salida
     * simultánea).
     */
    private List<RespuestaPatch> dispararPatchesConcurrentes(String id, List<ParPatch> pares)
            throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(pares.size());
        try {
            CountDownLatch salida = new CountDownLatch(1);
            List<Future<RespuestaPatch>> futuros = new ArrayList<>();
            for (ParPatch envio : pares) {
                futuros.add(pool.submit(() -> {
                    salida.await(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS);
                    return parchear(id, envio);
                }));
            }
            salida.countDown();

            List<RespuestaPatch> respuestas = new ArrayList<>();
            for (Future<RespuestaPatch> futuro : futuros) {
                respuestas.add(futuro.get(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS));
            }
            return respuestas;
        } finally {
            pool.shutdownNow();
            pool.awaitTermination(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS);
        }
    }

    /**
     * Prueba de concurrencia real: las ventanas [inicio, fin] de todas las
     * peticiones comparten un instante (último inicio &lt; primer fin). Si dos
     * PATCH se serializaran, el caso no probaría el AC.
     */
    private static void afirmarVentanasSolapadas(List<RespuestaPatch> respuestas) {
        long ultimoInicio = respuestas.stream()
                .mapToLong(RespuestaPatch::inicioNanos).max().orElseThrow();
        long primerFin = respuestas.stream()
                .mapToLong(RespuestaPatch::finNanos).min().orElseThrow();
        assertTrue(ultimoInicio < primerFin,
                "las peticiones no se solaparon en el tiempo (último inicio=" + ultimoInicio
                        + " >= primer fin=" + primerFin
                        + "): sin concurrencia real el caso no prueba el AC2");
    }

    /**
     * El par final debe ser EXACTAMENTE uno de los enviados. La pertenencia al
     * conjunto ya descarta todo híbrido; además se comparan de forma explícita los
     * dos cruces (estado de uno con nivel del otro) para que el fallo sea legible.
     */
    private static void afirmarUnoDeLosEnviadosSinHibrido(Par finalBase, List<ParPatch> pares) {
        assertTrue(pares.stream().anyMatch(envio -> envio.par().equals(finalBase)),
                "el estado final debe ser exactamente uno de los pares enviados; la base quedó en "
                        + finalBase + " y se enviaron " + pares.stream().map(ParPatch::par).toList());

        Par hibridoEstadoRangelNivelCentro = new Par(PAR_RANGEL.estado(), PAR_CENTRO.nivel());
        Par hibridoEstadoCentroNivelRangel = new Par(PAR_CENTRO.estado(), PAR_RANGEL.nivel());
        assertNotEquals(hibridoEstadoRangelNivelCentro, finalBase,
                "estado híbrido detectado: el estado de un PATCH con el nivel de otro");
        assertNotEquals(hibridoEstadoCentroNivelRangel, finalBase,
                "estado híbrido detectado: el estado de un PATCH con el nivel de otro");
    }

    // -----------------------------------------------------------------------
    // HTTP con el cliente del JDK (soporta PATCH)
    // -----------------------------------------------------------------------

    private HttpRequest.Builder base(String ruta) {
        return HttpRequest.newBuilder(URI.create("http://localhost:" + puerto + ruta))
                .timeout(Duration.ofSeconds(TIMEOUT_SEGUNDOS));
    }

    private String iniciarSesion(String email, String password) throws Exception {
        String cuerpo = objectMapper.writeValueAsString(Map.of("email", email, "password", password));
        HttpRequest peticion = base("/api/v1/sesiones")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(cuerpo))
                .build();
        HttpResponse<String> respuesta = http.send(peticion, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, respuesta.statusCode(),
                "el login real debe responder 200 para " + email + "; cuerpo=" + respuesta.body());
        return objectMapper.readTree(respuesta.body()).get("token").asText();
    }

    private String reportarEmergencia(String token, String descripcion) throws Exception {
        String cuerpo = objectMapper.writeValueAsString(Map.of(
                "ubicacion", Map.of("lat", SUBA_LAT, "lng", SUBA_LNG),
                "nivel", "BAJO",
                "descripcion", descripcion));
        HttpRequest peticion = base("/api/v1/emergencias")
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.ofString(cuerpo))
                .build();
        HttpResponse<String> respuesta = http.send(peticion, HttpResponse.BodyHandlers.ofString());
        assertEquals(201, respuesta.statusCode(),
                "el POST real de la emergencia debe responder 201; cuerpo=" + respuesta.body());
        return objectMapper.readTree(respuesta.body()).get("id").asText();
    }

    /** Un PATCH real, con la ventana temporal de la petición para probar solapamiento. */
    private RespuestaPatch parchear(String id, ParPatch envio) throws Exception {
        String cuerpo = objectMapper.writeValueAsString(Map.of(
                "estado", envio.par().estado(),
                "nivel", envio.par().nivel()));
        HttpRequest peticion = base("/api/v1/emergencias/" + id)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + envio.token())
                .method("PATCH", HttpRequest.BodyPublishers.ofString(cuerpo))
                .build();
        long inicio = System.nanoTime();
        HttpResponse<String> respuesta = http.send(peticion, HttpResponse.BodyHandlers.ofString());
        long fin = System.nanoTime();
        return new RespuestaPatch(envio, respuesta.statusCode(), respuesta.body(), inicio, fin);
    }

    /** Lee por GET el par (estado, nivel) de la emergencia creada. */
    private Par leerParPorGet(String token, String id) throws Exception {
        HttpRequest peticion = base("/api/v1/emergencias")
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();
        HttpResponse<String> respuesta = http.send(peticion, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, respuesta.statusCode(), "GET /emergencias debe responder 200");
        JsonNode emergencias = objectMapper.readTree(respuesta.body());
        for (JsonNode emergencia : emergencias) {
            if (id.equals(emergencia.path("id").asText())) {
                return parDe(emergencia);
            }
        }
        throw new AssertionError("GET /emergencias no incluyó la emergencia " + id);
    }

    /** Lee de la base (repositorio real) el par persistido. */
    private Par leerParDeLaBase(String id) {
        return emergenciaJpaRepository.findById(UUID.fromString(id))
                .map(entidad -> new Par(entidad.getEstado().name(), entidad.getNivel().name()))
                .orElseThrow(() -> new AssertionError("la emergencia debe existir en la base: " + id));
    }

    private static Par parDe(JsonNode emergencia) {
        return new Par(emergencia.path("estado").asText(), emergencia.path("nivel").asText());
    }

    private String urlWs() {
        return "ws://localhost:" + puerto + "/ws";
    }

    // -----------------------------------------------------------------------
    // Infraestructura STOMP de prueba
    // -----------------------------------------------------------------------

    /**
     * Confirma que el broker ya registró la suscripción. El simple broker de
     * Spring NO emite RECEIPT para SUBSCRIBE, así que la señal fiable es que
     * llegue un mensaje publicado DESPUÉS del SUBSCRIBE: se publica una marca de
     * calentamiento por el PushPort real (el mismo camino que el evento) y se
     * espera a verla. Sin esto, el disparo real podría perderse en la ventana
     * entre el SUBSCRIBE y su registro.
     */
    private void confirmarSuscripcion(String destino, SesionStomp sesion) throws Exception {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        while (System.nanoTime() < limite) {
            sesion.drenar();
            pushPort.publicar(destino, Map.of("tipo", "calentamiento-suscripcion"));
            if (sesion.esperarFrame(1) != null) {
                sesion.drenar();
                return;
            }
        }
        fail("no se pudo confirmar que la suscripción a " + destino + " esté activa");
    }

    /**
     * Sesión STOMP de prueba adaptada del enfoque de
     * {@code CanalTiempoRealDosSesionesTest}: cliente SockJS con un único
     * transporte WebSocket nativo (el endpoint es SockJS-only), confirmación del
     * CONNECT con latch —nunca {@code Thread.sleep}— y cola de frames recibidos.
     * No se puede importar la clase original porque es {@code private static}
     * dentro del test de origen.
     */
    private static final class SesionStomp {

        private static final String CABECERA_AUTHORIZATION = "Authorization";

        private final WebSocketStompClient cliente;
        private final StompHeaders connectHeaders = new StompHeaders();
        private final CountDownLatch conectado = new CountDownLatch(1);
        private final AtomicReference<Throwable> causaRechazo = new AtomicReference<>();
        private final BlockingQueue<JsonNode> recibidos = new LinkedBlockingQueue<>();
        private final List<StompSession.Subscription> suscripciones = new ArrayList<>();

        private StompSession sesion;

        SesionStomp(ThreadPoolTaskScheduler planificador) {
            List<Transport> transportes =
                    List.of(new WebSocketTransport(new StandardWebSocketClient()));
            this.cliente = new WebSocketStompClient(new SockJsClient(transportes));
            // El frame llega como application/json: Jackson permite pedir JsonNode.
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
            cliente.connectAsync(url, new WebSocketHttpHeaders(), connectHeaders, handler);
        }

        void suscribir(String destino) throws Exception {
            assertTrue(conectado.await(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS),
                    "la sesión STOMP no recibió el CONNECT a tiempo; causa=" + causaRechazo.get());

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

        void drenar() {
            recibidos.clear();
        }

        /**
         * Espera hasta {@code esperados} frames cuyo {@code id} coincida,
         * descartando cualquier otro (marcas de calentamiento o eventos de otros
         * ids). Devuelve los encontrados en orden de recepción.
         */
        List<JsonNode> framesConId(String id, int esperados, long segundos)
                throws InterruptedException {
            long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(segundos);
            List<JsonNode> encontrados = new ArrayList<>();
            while (encontrados.size() < esperados && System.nanoTime() < limite) {
                JsonNode frame = recibidos.poll(200, TimeUnit.MILLISECONDS);
                if (frame != null && frame.hasNonNull("id") && id.equals(frame.get("id").asText())) {
                    encontrados.add(frame);
                }
            }
            return encontrados;
        }

        private void registrarRechazo(Throwable exception) {
            causaRechazo.compareAndSet(null, exception);
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
                // Idem: la conexión puede haberse cerrado ya.
            }
            try {
                cliente.stop();
            } catch (Exception ignorado) {
                // Idem.
            }
        }
    }

    // -----------------------------------------------------------------------
    // Tipos de apoyo
    // -----------------------------------------------------------------------

    /** Un par (estado, nivel) del contrato. */
    private record Par(String estado, String nivel) {
    }

    /** Un PATCH a disparar: el token del usuario autorizado y el par que envía. */
    private record ParPatch(String token, Par par) {
    }

    /** Respuesta de un PATCH con la ventana temporal de la petición. */
    private record RespuestaPatch(ParPatch envio, int status, String cuerpo,
                                  long inicioNanos, long finNanos) {
    }
}
