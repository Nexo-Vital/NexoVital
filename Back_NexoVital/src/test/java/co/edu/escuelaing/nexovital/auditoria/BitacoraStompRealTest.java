package co.edu.escuelaing.nexovital.auditoria;

import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.BitacoraPeticionesAdapter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.lang.NonNull;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.web.socket.sockjs.client.SockJsClient;
import org.springframework.web.socket.sockjs.client.WebSocketTransport;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * T16 sobre el canal real: un servidor de verdad ({@code RANDOM_PORT}), un
 * cliente SockJS como el del front y la bitácora escrita en la base. Verifica
 * que el CONNECT y el SUBSCRIBE de una sesión válida, y el CONNECT rechazado sin
 * token, quedan registrados con la IP y el navegador del handshake.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class BitacoraStompRealTest {

    private static final long TIMEOUT_SEGUNDOS = 10;

    @LocalServerPort
    private int puerto;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private BitacoraPeticionesAdapter bitacora;

    private ThreadPoolTaskScheduler planificador;
    private WebSocketStompClient cliente;

    @BeforeEach
    void preparar() {
        planificador = new ThreadPoolTaskScheduler();
        planificador.setPoolSize(1);
        planificador.setDaemon(true);
        planificador.initialize();
        cliente = new WebSocketStompClient(
                new SockJsClient(List.of(new WebSocketTransport(new StandardWebSocketClient()))));
        cliente.setTaskScheduler(planificador);
    }

    @AfterEach
    void cerrar() {
        cliente.stop();
        planificador.shutdown();
    }

    @Test
    @DisplayName("CONNECT y SUBSCRIBE de una sesion valida quedan con usuario, IP y navegador")
    void sesionValidaQuedaRegistrada() throws Exception {
        String navegador = "BitacoraStompRealTest/" + UUID.randomUUID();
        StompSession sesion = conectar(navegador, token("ciudadano@nexovital.co", "ciudadano123"))
                .get(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS);
        sesion.subscribe("/topic/flota", new StompSessionHandlerAdapter() { });
        sesion.disconnect();

        List<Map<String, Object>> filas = esperarFilas(navegador, 2);
        assertEquals("CONNECT", filas.get(0).get("METODO"));
        assertEquals(200, ((Number) filas.get(0).get("ESTADO")).intValue());
        assertEquals("ciudadano@nexovital.co", filas.get(0).get("ACTOR"));
        assertEquals("127.0.0.1", filas.get(0).get("IP"));
        assertEquals("LOCAL", filas.get(0).get("PAIS"));
        assertTrue(filas.stream().anyMatch(fila -> "SUBSCRIBE".equals(fila.get("METODO"))
                && "/topic/flota".equals(fila.get("RUTA"))));
    }

    @Test
    @DisplayName("Un CONNECT sin token queda como rechazado (403) con su motivo")
    void connectSinTokenQuedaRechazado() throws Exception {
        String navegador = "BitacoraStompRealTest/" + UUID.randomUUID();
        CountDownLatch rechazado = new CountDownLatch(1);
        cliente.connectAsync(url(), cabeceras(navegador), new StompHeaders(), new StompSessionHandlerAdapter() {
            @Override
            public void handleException(@NonNull StompSession s, StompCommand c, @NonNull StompHeaders h,
                                        @NonNull byte[] p, @NonNull Throwable e) {
                rechazado.countDown();
            }

            @Override
            public void handleTransportError(@NonNull StompSession s, @NonNull Throwable e) {
                rechazado.countDown();
            }
        });
        assertTrue(rechazado.await(TIMEOUT_SEGUNDOS, TimeUnit.SECONDS), "el CONNECT sin token debe rechazarse");

        List<Map<String, Object>> filas = esperarFilas(navegador, 1);
        assertEquals("CONNECT", filas.get(0).get("METODO"));
        assertEquals(403, ((Number) filas.get(0).get("ESTADO")).intValue());
        assertEquals("token_ausente", filas.get(0).get("DETALLE"));
    }

    private CompletableFuture<StompSession> conectar(String navegador, String token) {
        StompHeaders connect = new StompHeaders();
        connect.add("Authorization", "Bearer " + token);
        return cliente.connectAsync(url(), cabeceras(navegador), connect, new StompSessionHandlerAdapter() { });
    }

    private static WebSocketHttpHeaders cabeceras(String navegador) {
        WebSocketHttpHeaders cabeceras = new WebSocketHttpHeaders();
        cabeceras.add("User-Agent", navegador);
        return cabeceras;
    }

    private String url() {
        return "ws://localhost:" + puerto + "/ws";
    }

    private String token(String email, String password) throws Exception {
        ResponseEntity<String> respuesta = restTemplate.postForEntity("/api/v1/sesiones",
                Map.of("email", email, "password", password), String.class);
        return objectMapper.readTree(respuesta.getBody()).get("token").asText();
    }

    /** La bitácora es asíncrona: se vacía y se espera, con tope, a que aparezcan las filas. */
    private List<Map<String, Object>> esperarFilas(String navegador, int minimo) throws InterruptedException {
        long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SEGUNDOS);
        List<Map<String, Object>> filas = List.of();
        while (System.nanoTime() < limite) {
            bitacora.vaciar();
            filas = jdbcTemplate.queryForList("SELECT metodo, ruta, estado, actor, ip, pais, detalle"
                    + " FROM auditoria_peticiones WHERE canal = 'STOMP' AND navegador = ?"
                    + " ORDER BY CASE metodo WHEN 'CONNECT' THEN 0 ELSE 1 END", navegador);
            if (filas.size() >= minimo) {
                return filas;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("se esperaban al menos " + minimo + " filas STOMP y hay " + filas.size());
    }
}
