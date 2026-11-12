package co.edu.escuelaing.nexovital.auditoria;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.BitacoraPeticionesPort;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.BitacoraPeticionesAdapter;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.PeticionRegistradaJpaEntity;
import co.edu.escuelaing.nexovital.observabilidad.infrastructure.TraceId;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-06.F2.US2 (S-2), T14–T16: toda petición queda en la bitácora con hora, IP,
 * usuario, navegador y país; se consulta por petición, usuario, emergencia o
 * centro; y no se puede modificar.
 *
 * <p>La bitácora escribe por lotes en otro hilo. Las pruebas llaman a
 * {@link BitacoraPeticionesAdapter#vaciar()} para no depender del temporizador.
 * La base de países es la de prueba ({@code application-test.properties}).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class BitacoraPeticionesHttpTest extends LoginTestBase {

    private static final String ADMIN = "admin@nexovital.co";
    private static final String ADMIN_PASSWORD = "admin123";
    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String NAVEGADOR = "Mozilla/5.0 (Macintosh) PruebaBitacora/1.0";
    private static final String PETICIONES = "/api/v1/auditoria/peticiones";

    @Autowired
    private BitacoraPeticionesAdapter bitacora;

    @Autowired
    private BitacoraPeticionesPort bitacoraPort;

    @Autowired
    private RegistroAuditoriaPort registroAuditoriaPort;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private TransactionTemplate transaccion;

    // -----------------------------------------------------------------------
    // T14: qué se guarda de cada petición
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Una peticion anonima rechazada con 401 queda con IP real, pais, navegador y motivo")
    void anonimaRechazadaQuedaRegistrada() throws Exception {
        String traza = traza("anon");

        mockMvc.perform(get("/api/v1/mapa")
                        .header(TraceId.CABECERA, traza)
                        .header("X-Forwarded-For", "190.24.1.1, 10.0.0.7")
                        .header("User-Agent", NAVEGADOR))
                .andExpect(status().isUnauthorized());

        PeticionRegistrada fila = unicaFila(traza);
        assertEquals(PeticionRegistrada.CANAL_HTTP, fila.canal());
        assertEquals("GET", fila.metodo());
        assertEquals("/api/v1/mapa", fila.ruta());
        assertEquals(401, fila.estado());
        assertEquals(PeticionRegistrada.ACTOR_ANONIMO, fila.actor());
        assertNull(fila.usuarioId());
        // Primera entrada de X-Forwarded-For: la que escribe nginx.
        assertEquals("190.24.1.1", fila.ip());
        assertEquals("CO", fila.pais());
        assertEquals(NAVEGADOR, fila.navegador());
        assertEquals("token_ausente", fila.detalle());
        assertNotNull(fila.ocurridoEn());
        assertNotNull(fila.instancia());
        assertNotNull(fila.duracionMs());
    }

    @Test
    @DisplayName("Una peticion autenticada queda con el usuario y su rol; sin proxy, la IP es la de la conexion")
    void autenticadaQuedaConUsuario() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String traza = traza("usuario");

        mockMvc.perform(get("/api/v1/mapa")
                        .header("Authorization", "Bearer " + token)
                        .header(TraceId.CABECERA, traza)
                        .header("User-Agent", NAVEGADOR))
                .andExpect(status().isOk());

        PeticionRegistrada fila = unicaFila(traza);
        assertEquals(200, fila.estado());
        assertEquals(usuarioDe(CIUDADANO).getId(), fila.usuarioId());
        assertEquals("CIUDADANO", fila.usuarioRol());
        assertEquals(CIUDADANO, fila.actor());
        assertEquals("127.0.0.1", fila.ip());
        assertEquals("LOCAL", fila.pais());
        assertNull(fila.detalle());
    }

    @Test
    @DisplayName("Un 403 por rol queda con el usuario y el motivo del rechazo")
    void rechazoPorRolQuedaRegistrado() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String traza = traza("rol");

        mockMvc.perform(get(PETICIONES)
                        .header("Authorization", "Bearer " + token)
                        .header(TraceId.CABECERA, traza))
                .andExpect(status().isForbidden());

        PeticionRegistrada fila = unicaFila(traza);
        assertEquals(403, fila.estado());
        assertEquals("CIUDADANO", fila.usuarioRol());
        assertEquals("rol_insuficiente", fila.detalle());
    }

    @Test
    @DisplayName("El raspado de metricas y la sonda de salud no llenan la bitacora")
    void rutasExcluidas() throws Exception {
        String traza = traza("salud");

        mockMvc.perform(get("/actuator/health").header(TraceId.CABECERA, traza));

        bitacora.vaciar();
        assertTrue(filasDe(traza).isEmpty());
    }

    // -----------------------------------------------------------------------
    // T16: el 100 % de las peticiones queda registrado
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("200 peticiones concurrentes, mezcladas y con distintos resultados: las 200 quedan registradas")
    void cienPorCientoBajoConcurrencia() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String lote = "bit-lote-" + UUID.randomUUID().toString().substring(0, 8);
        int total = 200;

        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Future<?>> futuros = new ArrayList<>();
            for (int i = 0; i < total; i++) {
                int n = i;
                futuros.add(pool.submit(() -> {
                    MockHttpServletRequestBuilder peticion = switch (n % 4) {
                        case 0 -> get("/api/v1/mapa").header("Authorization", "Bearer " + token); // 200
                        case 1 -> get("/api/v1/mapa"); // 401
                        case 2 -> get(PETICIONES).header("Authorization", "Bearer " + token); // 403
                        default -> get("/api/v1/no-existe").header("Authorization", "Bearer " + token); // 403
                    };
                    mockMvc.perform(peticion.header(TraceId.CABECERA, lote + "-" + n));
                    return null;
                }));
            }
            for (Future<?> futuro : futuros) {
                futuro.get();
            }
        } finally {
            pool.shutdown();
        }
        bitacora.vaciar();

        List<String> trazas = jdbcTemplate.queryForList(
                "SELECT trace_id FROM auditoria_peticiones WHERE trace_id LIKE ?", String.class, lote + "-%");
        assertEquals(total, trazas.size(), "cada peticion deja exactamente una fila");
        assertEquals(total, new HashSet<>(trazas).size(), "ninguna peticion se registra dos veces");
    }

    @Test
    @DisplayName("Registrar no toca la base en el hilo de la peticion: 5000 registros toman menos de 1 s")
    void registrarNoBloquea() {
        String lote = "bit-rapido-" + UUID.randomUUID().toString().substring(0, 8);
        long inicio = System.nanoTime();
        for (int i = 0; i < 5000; i++) {
            bitacoraPort.registrar(fila(lote + "-" + i, "/api/v1/mapa", null));
        }
        long ms = (System.nanoTime() - inicio) / 1_000_000;
        bitacora.vaciar();

        assertTrue(ms < 1000, "registrar 5000 filas tomo " + ms + " ms");
        Integer escritas = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM auditoria_peticiones WHERE trace_id LIKE ?", Integer.class, lote + "-%");
        assertEquals(5000, escritas);
    }

    // -----------------------------------------------------------------------
    // T15: consulta por petición, usuario, emergencia o centro
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Solo el administrador de plataforma consulta la bitacora (401 sin token, 403 otros roles)")
    void consultaSoloAdmin() throws Exception {
        mockMvc.perform(get(PETICIONES)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(PETICIONES)
                        .header("Authorization", "Bearer " + tokenDe(CIUDADANO, CIUDADANO_PASSWORD)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(PETICIONES)
                        .header("Authorization", "Bearer " + tokenDe(ADMIN, ADMIN_PASSWORD)))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Consulta por peticion (traceId) y por usuario")
    void consultaPorPeticionYUsuario() throws Exception {
        String tokenCiudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String traza = traza("consulta");
        mockMvc.perform(get("/api/v1/mapa")
                        .header("Authorization", "Bearer " + tokenCiudadano)
                        .header(TraceId.CABECERA, traza))
                .andExpect(status().isOk());
        bitacora.vaciar();
        String admin = tokenDe(ADMIN, ADMIN_PASSWORD);

        JsonNode porTraza = consultar(admin, "traceId=" + traza);
        assertEquals(1, porTraza.size());
        assertEquals("/api/v1/mapa", porTraza.get(0).get("ruta").asText());
        assertEquals(CIUDADANO, porTraza.get(0).get("actor").asText());

        UUID ciudadanoId = usuarioDe(CIUDADANO).getId();
        JsonNode porUsuario = consultar(admin, "usuarioId=" + ciudadanoId + "&limite=1000");
        assertFalse(porUsuario.isEmpty());
        for (JsonNode fila : porUsuario) {
            assertEquals(ciudadanoId.toString(), fila.get("usuarioId").asText());
        }
        assertTrue(contieneTraza(porUsuario, traza));
    }

    @Test
    @DisplayName("Consulta por centro: las peticiones cuya ruta lleva el id del centro")
    void consultaPorCentro() throws Exception {
        UUID centroId = UUID.randomUUID();
        String traza = traza("centro");
        mockMvc.perform(get("/api/v1/centros-acopio/{id}/inventario", centroId)
                .header("Authorization", "Bearer " + tokenDe(CIUDADANO, CIUDADANO_PASSWORD))
                .header(TraceId.CABECERA, traza));
        bitacora.vaciar();

        JsonNode filas = consultar(tokenDe(ADMIN, ADMIN_PASSWORD), "centroId=" + centroId);
        assertEquals(1, filas.size());
        assertEquals(traza, filas.get(0).get("traceId").asText());
    }

    @Test
    @DisplayName("Consulta por emergencia: incluye la peticion que la creo aunque su ruta no tenga el id")
    void consultaPorEmergenciaEnlazaLaAccionCritica() throws Exception {
        UUID emergenciaId = UUID.randomUUID();
        String traza = traza("emergencia");
        // El POST que reporta la emergencia: su ruta no lleva el id...
        bitacoraPort.registrar(fila(traza, "/api/v1/emergencias", "POST"));
        // ...pero la accion critica que genero si, y comparte el traceId.
        registroAuditoriaPort.registrar(new EventoAuditoria(UUID.randomUUID(), null, "CIUDADANO",
                AccionCritica.EMERGENCIA_REPORTADA, EventoAuditoria.TIPO_EMERGENCIA, emergenciaId,
                "reporte", Instant.now(), traza));
        bitacora.vaciar();

        JsonNode filas = consultar(tokenDe(ADMIN, ADMIN_PASSWORD), "emergenciaId=" + emergenciaId);
        assertTrue(contieneTraza(filas, traza), "la consulta por emergencia trae la peticion que la creo");
    }

    @Test
    @DisplayName("Una accion critica guarda el traceId de la peticion que la origino")
    void accionCriticaGuardaElTraceId() {
        UUID centroId = UUID.randomUUID();
        String traza = traza("accion");
        TraceId.poner(traza);
        try {
            registroAuditoriaPort.registrar(EventoAuditoria.nuevo(AccionCritica.INSUMO_DONADO,
                    EventoAuditoria.TIPO_CENTRO, centroId, null, "donacion", Instant.now()));
        } finally {
            TraceId.limpiar();
        }
        assertEquals(traza, registroAuditoriaPort.porRecurso(EventoAuditoria.TIPO_CENTRO, centroId)
                .get(0).traceId());
    }

    // -----------------------------------------------------------------------
    // T16: la bitácora no se puede modificar
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("La API no ofrece forma de crear, cambiar ni borrar filas de la bitacora")
    void apiSinEscritura() throws Exception {
        String admin = tokenDe(ADMIN, ADMIN_PASSWORD);
        String traza = traza("inmutable");
        bitacoraPort.registrar(fila(traza, "/api/v1/mapa", null));
        bitacora.vaciar();

        for (MockHttpServletRequestBuilder intento : List.of(
                post(PETICIONES), put(PETICIONES), patch(PETICIONES), delete(PETICIONES),
                delete(PETICIONES + "/" + unicaFila(traza).id()))) {
            int estado = mockMvc.perform(intento.header("Authorization", "Bearer " + admin))
                    .andReturn().getResponse().getStatus();
            assertTrue(estado >= 400, "ninguna escritura sobre la bitacora responde 2xx: " + estado);
        }
        assertEquals("/api/v1/mapa", unicaFila(traza).ruta(), "la fila sigue intacta");
    }

    @Test
    @DisplayName("Una fila escrita no se reescribe aunque se intente desde JPA")
    void filaNoSeReescribe() throws Exception {
        String traza = traza("jpa");
        bitacoraPort.registrar(fila(traza, "/ruta/original", null));
        bitacora.vaciar();
        UUID id = unicaFila(traza).id();

        transaccion.executeWithoutResult(estado -> {
            PeticionRegistradaJpaEntity entidad = entityManager.find(PeticionRegistradaJpaEntity.class, id);
            try {
                Field ruta = PeticionRegistradaJpaEntity.class.getDeclaredField("ruta");
                ruta.setAccessible(true);
                ruta.set(entidad, "/ruta/alterada");
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
            entityManager.flush();
        });

        assertEquals("/ruta/original", unicaFila(traza).ruta());
    }

    @Test
    @DisplayName("Ni el puerto ni la entidad exponen operaciones para modificar o borrar")
    void sinOperacionesDeEscritura() {
        Set<String> metodosPuerto = new HashSet<>();
        for (Method metodo : BitacoraPeticionesPort.class.getDeclaredMethods()) {
            metodosPuerto.add(metodo.getName());
        }
        assertEquals(Set.of("registrar", "buscar"), metodosPuerto);
        assertTrue(Arrays.stream(PeticionRegistradaJpaEntity.class.getDeclaredMethods())
                        .noneMatch(metodo -> metodo.getName().startsWith("set")),
                "la entidad no tiene setters");
    }

    // -----------------------------------------------------------------------

    private static String traza(String caso) {
        return "bit-" + caso + "-" + UUID.randomUUID();
    }

    private static PeticionRegistrada fila(String traza, String ruta, String metodo) {
        return new PeticionRegistrada(UUID.randomUUID(), Instant.now(), PeticionRegistrada.CANAL_HTTP,
                metodo == null ? "GET" : metodo, ruta, 200, 3L, null, null,
                PeticionRegistrada.ACTOR_ANONIMO, "127.0.0.1", null, NAVEGADOR, traza, "prueba", null);
    }

    private List<PeticionRegistrada> filasDe(String traza) {
        return bitacoraPort.buscar(new FiltroBitacora(traza, null, null, null, null, 10));
    }

    private PeticionRegistrada unicaFila(String traza) {
        bitacora.vaciar();
        List<PeticionRegistrada> filas = filasDe(traza);
        assertEquals(1, filas.size(), "se esperaba exactamente una fila para " + traza);
        return filas.get(0);
    }

    private JsonNode consultar(String token, String query) throws Exception {
        MvcResult resultado = mockMvc.perform(get(PETICIONES + "?" + query)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(resultado.getResponse().getContentAsString());
    }

    private static boolean contieneTraza(JsonNode filas, String traza) {
        for (JsonNode fila : filas) {
            if (traza.equals(fila.get("traceId").asText())) {
                return true;
            }
        }
        return false;
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
