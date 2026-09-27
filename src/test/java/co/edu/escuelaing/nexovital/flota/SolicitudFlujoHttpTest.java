package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.FlotaPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP cases of the C2 request flow, protected by the fail-closed chain.
 *
 * <p>Covers AC1 (EVERY available unit is notified, one user destination each),
 * AC3 (the accepted unit becomes occupied and the change is propagated to
 * {@code /topic/flota}), AC4 (a decline leaves the request open), AC5 (fleet
 * read model) and AC7 (401 without a token, 403 with the wrong role).
 *
 * <p>The broadcast is asserted against the {@link PushPortDePrueba}
 * ({@code @Primary}) so the test sees exactly what the post-commit listener
 * published, without the broker. AC1 also checks there is NO publication to
 * {@code /queue/solicitudes} without a user: that shared form would be
 * round-robin and would reach only one unit (D-F1).
 *
 * <p>Each test seeds its OWN units in a random zone and deletes them
 * afterwards: the test H2 is shared and AC5 asserts the seeded catalog, so a
 * test must not alter the fleet another test reads.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudFlujoHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String CONDUCTOR = "conductor1@nexovital.co";
    private static final String CONDUCTOR_PASSWORD = "conductor123";

    /** The five plates D-F6 seeds, one per conductor. */
    private static final List<String> PLACAS_SEMILLA =
            List.of("ABC101", "ABC202", "ABC303", "ABC404", "ABC505");

    private static final int UNIDADES_DE_PRUEBA = 3;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    private String zona;
    private final List<UUID> sembradas = new ArrayList<>();
    private final Map<UUID, UUID> conductorPorAmbulancia = new HashMap<>();

    @BeforeEach
    void sembrarAmbulanciasDePrueba() {
        pushPortDePrueba.limpiar();
        zona = "PruebaFlota-" + UUID.randomUUID();
        for (int i = 0; i < UNIDADES_DE_PRUEBA; i++) {
            UUID ambulanciaId = UUID.randomUUID();
            UUID conductorId = UUID.randomUUID();
            ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                    ambulanciaId, "PRB" + i, EstadoAmbulancia.DISPONIBLE,
                    4.73d + i * 0.001d, -74.08d, zona, conductorId));
            sembradas.add(ambulanciaId);
            conductorPorAmbulancia.put(ambulanciaId, conductorId);
        }
    }

    @AfterEach
    void limpiar() {
        ambulanciaJpaRepository.deleteAllById(sembradas);
        sembradas.clear();
        conductorPorAmbulancia.clear();
        pushPortDePrueba.limpiar();
    }

    // -----------------------------------------------------------------------
    // AC1 — every available unit receives its own notification
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC1: POST /solicitudes notifica a CADA ambulancia disponible por su destino de usuario, no a una sola")
    void ac1_cadaAmbulanciaDisponibleRecibeSuNotificacion() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/solicitudes")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSolicitud(zona)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.estado").value("PENDIENTE"))
                .andExpect(jsonPath("$.ambulanciasNotificadas.length()").value(UNIDADES_DE_PRUEBA));

        for (UUID conductorId : conductorPorAmbulancia.values()) {
            List<PublicacionCapturada> entregas = pushPortDePrueba.haciaUsuario(
                    conductorId.toString(), FlotaPushListener.DESTINO_SOLICITUDES);
            assertEquals(1, entregas.size(),
                    "cada ambulancia disponible debe recibir UNA entrega en su destino de usuario: " + conductorId);
        }

        long broadcastCompartido = pushPortDePrueba.publicaciones().stream()
                .filter(publicacion -> FlotaPushListener.DESTINO_SOLICITUDES.equals(publicacion.destino()))
                .filter(publicacion -> publicacion.usuario() == null)
                .count();
        assertEquals(0, broadcastCompartido,
                "no debe existir una entrega a /queue/solicitudes sin usuario: el simple broker la repartiría en round-robin");
    }

    // -----------------------------------------------------------------------
    // AC3 — accept occupies the unit and propagates to /topic/flota
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC3: al aceptar, la ambulancia queda EN_MISION y se propaga por /topic/flota")
    void ac3_aceptarOcupaLaAmbulanciaYPropagaPorTopicFlota() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        UUID unidad = sembradas.get(0);
        String solicitudId = crearSolicitud(ciudadano, zona);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.estado").value("ASIGNADA"))
                .andExpect(jsonPath("$.solicitud.ambulanciaAsignadaId").value(unidad.toString()));

        assertEquals(EstadoAmbulancia.EN_MISION,
                ambulanciaJpaRepository.findById(unidad).orElseThrow().getEstado(),
                "la unidad ganadora queda ocupada en la misma operación");

        PublicacionCapturada flota = pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA);
        assertNotNull(flota, "el accept debe propagar el cambio a /topic/flota");
        assertInstanceOf(FlotaPushPayload.class, flota.payload());
        assertEquals(unidad, ((FlotaPushPayload) flota.payload()).ambulanciaId());
        assertEquals("EN_MISION", ((FlotaPushPayload) flota.payload()).estado());
    }

    // -----------------------------------------------------------------------
    // AC4 — a decline leaves the request available for the others
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC4: rechazar deja la solicitud PENDIENTE y otra ambulancia puede aceptarla")
    void ac4_rechazarDejaLaSolicitudDisponibleParaLasDemas() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        UUID primera = sembradas.get(0);
        UUID segunda = sembradas.get(1);
        String solicitudId = crearSolicitud(ciudadano, zona);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/reject", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(primera)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("PENDIENTE"));

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(segunda)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.ambulanciaAsignadaId").value(segunda.toString()));
    }

    // -----------------------------------------------------------------------
    // AC5 — fleet read model with position and state
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC5: GET /flota/ambulancias lista la flota sembrada con posición y estado")
    void ac5_listaLaFlotaConPosicionYEstado() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        MvcResult result = mockMvc.perform(get("/api/v1/flota/ambulancias")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode flota = objectMapper.readTree(result.getResponse().getContentAsString());
        assertTrue(flota.isArray(), "la flota es un arreglo JSON");
        Set<String> placas = new java.util.HashSet<>();
        for (JsonNode unidad : flota) {
            assertTrue(unidad.hasNonNull("estado"), "cada unidad declara su estado");
            assertTrue(unidad.path("ubicacion").hasNonNull("lat"), "cada unidad declara su posición");
            assertTrue(unidad.path("ubicacion").hasNonNull("lng"), "cada unidad declara su posición");
            placas.add(unidad.get("placa").asText());
        }
        assertTrue(placas.containsAll(PLACAS_SEMILLA),
                "la flota sembrada (D-F6) debe aparecer: " + PLACAS_SEMILLA + " pero fue " + placas);
    }

    // -----------------------------------------------------------------------
    // AC7 — fail-closed: 401 without a token, 403 with the wrong role
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC7: sin token, POST /solicitudes y GET /flota responden 401")
    void ac7_sinTokenDevuelve401() throws Exception {
        mockMvc.perform(post("/api/v1/solicitudes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSolicitud(zona)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));

        mockMvc.perform(get("/api/v1/flota/ambulancias"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    @DisplayName("AC7: un CIUDADANO no puede aceptar (403), el endpoint exige CONDUCTOR")
    void ac7_rolIncorrectoDevuelve403() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", UUID.randomUUID())
                        .header("Authorization", "Bearer " + ciudadano)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(UUID.randomUUID())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private String crearSolicitud(String token, String zona) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/solicitudes")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSolicitud(zona)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private String cuerpoSolicitud(String zona) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "emergenciaId", UUID.randomUUID().toString(),
                "centroAyudaId", UUID.randomUUID().toString(),
                "zonaId", zona));
    }

    private String cuerpoAmbulancia(UUID ambulanciaId) throws Exception {
        return objectMapper.writeValueAsString(Map.of("ambulanciaId", ambulanciaId.toString()));
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
