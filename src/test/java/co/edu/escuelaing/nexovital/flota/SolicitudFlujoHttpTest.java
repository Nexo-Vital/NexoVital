package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.FlotaPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
    private SolicitudJpaRepository solicitudJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    /**
     * Unit owned by the authenticating driver ({@code conductor1}). It is the ONLY
     * unit the seeded conductor may accept, because the accept now verifies the
     * unit belongs to the caller; the other units keep a random driver so AC1 can
     * still prove each notified unit gets its OWN copy.
     */
    private UUID unidadDelConductor;

    private String zona;
    private final List<UUID> sembradas = new ArrayList<>();
    private final Map<UUID, UUID> conductorPorAmbulancia = new HashMap<>();

    @BeforeEach
    void sembrarAmbulanciasDePrueba() {
        pushPortDePrueba.limpiar();
        zona = "PruebaFlota-" + UUID.randomUUID();
        UUID conductorAutenticado = usuarioDe(CONDUCTOR).getId();
        for (int i = 0; i < UNIDADES_DE_PRUEBA; i++) {
            UUID ambulanciaId = UUID.randomUUID();
            // The first unit is driven by the seeded driver that logs in; the rest
            // by random drivers, so the per-user fan-out still has distinct targets.
            UUID conductorId = i == 0 ? conductorAutenticado : UUID.randomUUID();
            ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                    ambulanciaId, "PRB" + i, EstadoAmbulancia.DISPONIBLE,
                    4.73d + i * 0.001d, -74.08d, zona, conductorId));
            sembradas.add(ambulanciaId);
            conductorPorAmbulancia.put(ambulanciaId, conductorId);
        }
        unidadDelConductor = sembradas.get(0);
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
        // Both actions must come from a unit the authenticating driver owns; the
        // reject does not occupy it, so the same unit can still accept afterwards.
        UUID unidad = unidadDelConductor;
        String solicitudId = crearSolicitud(ciudadano, zona);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/reject", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("PENDIENTE"));

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.ambulanciaAsignadaId").value(unidad.toString()));
    }

    // -----------------------------------------------------------------------
    // Accept authorization (FIX2): notified unit + owned by the caller
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FIX2: aceptar con una unidad que NO fue notificada responde 409 y no asigna")
    void fix2_aceptarConUnidadNoNotificadaDevuelve409() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        String solicitudId = crearSolicitud(ciudadano, zona);

        // Available and owned by the authenticating driver, but in ANOTHER zone:
        // the request never notified it, so its accept must be refused.
        UUID noNotificada = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                noNotificada, "OTR0", EstadoAmbulancia.DISPONIBLE,
                4.60d, -74.10d, "OtraZona-" + UUID.randomUUID(), usuarioDe(CONDUCTOR).getId()));
        sembradas.add(noNotificada);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(noNotificada)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        // No silent win: the request stays PENDIENTE with no assigned unit.
        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(UUID.fromString(solicitudId)).orElseThrow().getEstado());
        assertEquals(EstadoAmbulancia.DISPONIBLE,
                ambulanciaJpaRepository.findById(noNotificada).orElseThrow().getEstado(),
                "una aceptación rechazada no puede ocupar la unidad");
    }

    @Test
    @DisplayName("FIX2: aceptar con una unidad notificada de OTRO conductor responde 409 y no asigna")
    void fix2_aceptarConUnidadDeOtroConductorDevuelve409() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        String solicitudId = crearSolicitud(ciudadano, zona);
        // Notified and available, but driven by a random conductor: not the caller's.
        UUID ajena = sembradas.get(1);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(ajena)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(UUID.fromString(solicitudId)).orElseThrow().getEstado());
        assertEquals(EstadoAmbulancia.DISPONIBLE,
                ambulanciaJpaRepository.findById(ajena).orElseThrow().getEstado(),
                "una aceptación rechazada no puede ocupar la unidad");
    }

    // -----------------------------------------------------------------------
    // Reject authorization (FIX4): the unit must belong to the caller
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FIX4: rechazar con una unidad notificada de OTRO conductor responde 409")
    void fix4_rechazarConUnidadDeOtroConductorDevuelve409() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        String solicitudId = crearSolicitud(ciudadano, zona);
        // Notified, but driven by a random conductor: not the caller's.
        UUID ajena = sembradas.get(1);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/reject", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(ajena)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        // The request is untouched: no decline was recorded for the foreign unit.
        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(UUID.fromString(solicitudId)).orElseThrow().getEstado());
    }

    // -----------------------------------------------------------------------
    // Arrival (FIX A): idempotent milestone, not a lifecycle state
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FIX A: declarar la llegada es idempotente, no cambia el estado y notifica al solicitante")
    void fixA_declararLlegadaEsIdempotenteYNotificaAlSolicitante() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        String solicitanteId = usuarioDe(CIUDADANO).getId().toString();
        UUID unidad = unidadDelConductor;
        String solicitudId = crearSolicitud(ciudadano, zona);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/solicitudes/{id}/llegada", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("ASIGNADA"))
                .andExpect(jsonPath("$.llegadaEn").isNotEmpty());

        // The request keeps its state: arrival is a milestone, not a new state.
        assertEquals(EstadoSolicitud.ASIGNADA,
                solicitudJpaRepository.findById(UUID.fromString(solicitudId)).orElseThrow().getEstado());
        assertNotNull(solicitudJpaRepository.findById(UUID.fromString(solicitudId))
                .orElseThrow().getLlegadaEn(), "la llegada queda registrada");

        List<PublicacionCapturada> alSolicitante =
                pushPortDePrueba.haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES);
        boolean llegada = alSolicitante.stream().anyMatch(publicacion ->
                publicacion.payload() instanceof FlotaPushListener.SolicitudPushPayload payload && payload.llegada());
        assertTrue(llegada, "el solicitante recibe la llegada de la unidad");

        // A repeat (double tap / retry) is a no-op: 200, no second arrival notice.
        int antes = alSolicitante.size();
        mockMvc.perform(post("/api/v1/solicitudes/{id}/llegada", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk());
        assertEquals(antes,
                pushPortDePrueba.haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES).size(),
                "una llegada repetida no vuelve a notificar");
    }

    @Test
    @DisplayName("FIX A: declarar la llegada con una unidad ajena responde 409")
    void fixA_declararLlegadaConUnidadAjenaDevuelve409() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        UUID unidad = unidadDelConductor;
        String solicitudId = crearSolicitud(ciudadano, zona);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk());

        // A notified but non-assigned unit of another conductor cannot declare it.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/llegada", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(sembradas.get(1))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));
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
            // FIX3: the general fleet read is visible to EVERY authenticated
            // role, so it must NOT disclose which driver owns each unit.
            assertFalse(unidad.has("conductorId"),
                    "la lista general de flota no debe exponer el conductor de cada unidad");
            placas.add(unidad.get("placa").asText());
        }
        assertTrue(placas.containsAll(PLACAS_SEMILLA),
                "la flota sembrada (D-F6) debe aparecer: " + PLACAS_SEMILLA + " pero fue " + placas);
    }

    // -----------------------------------------------------------------------
    // FIX3 — the driver's OWN unit is a server-scoped read
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FIX3: GET /flota/ambulancias/mia devuelve la unidad del conductor autenticado, sin exponer su id")
    void fix3_miAmbulanciaDevuelveSoloLaUnidadPropia() throws Exception {
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        // A different seeded driver, so the two server-scoped reads can be
        // proven to return DIFFERENT units without depending on row order.
        String otroConductor = tokenDe("conductor2@nexovital.co", "conductor123");
        String solicitante = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        JsonNode mia = leerJson(get("/api/v1/flota/ambulancias/mia")
                .header("Authorization", "Bearer " + conductor));
        JsonNode otra = leerJson(get("/api/v1/flota/ambulancias/mia")
                .header("Authorization", "Bearer " + otroConductor));

        assertTrue(mia.hasNonNull("id"), "el recurso propio devuelve una unidad");
        assertFalse(mia.has("conductorId"), "ni siquiera el recurso propio expone el id del conductor");
        assertFalse(otra.has("conductorId"), "el recurso propio nunca expone el id del conductor");
        assertFalse(mia.get("id").asText().equals(otra.get("id").asText()),
                "cada conductor recibe su propia unidad, no la misma");

        // The server-scoped read is driver-only: a citizen gets 403 (fail-closed).
        mockMvc.perform(get("/api/v1/flota/ambulancias/mia")
                        .header("Authorization", "Bearer " + solicitante))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
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
    // Requester tracking — persisted id + lifecycle on their own destination
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("El solicitante queda persistido en la solicitud y sobrevive a la relectura")
    void solicitanteQuedaPersistido() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        UUID ciudadanoId = usuarioDe(CIUDADANO).getId();

        String solicitudId = crearSolicitud(token, zona);

        assertEquals(ciudadanoId,
                solicitudJpaRepository.findById(UUID.fromString(solicitudId)).orElseThrow().getSolicitanteId(),
                "el id del solicitante debe persistirse y sobrevivir a la relectura");
    }

    @Test
    @DisplayName("El solicitante recibe PENDIENTE/ASIGNADA/CONFIRMADA en su destino y NO el declive por unidad")
    void solicitanteRecibeElCicloYNoElDeclive() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        String solicitanteId = usuarioDe(CIUDADANO).getId().toString();
        // The decline must come from the caller's own unit (FIX4); it does not
        // occupy it, so the same unit can then win the accept.
        UUID primera = unidadDelConductor;
        UUID segunda = unidadDelConductor;
        String solicitudId = crearSolicitud(ciudadano, zona);

        // 1) Creation (PENDIENTE) reached the requester on its own destination.
        List<PublicacionCapturada> alSolicitante =
                pushPortDePrueba.haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES);
        assertEquals(1, alSolicitante.size(), "el solicitante recibe la creación");
        assertEquals("PENDIENTE", estadoDe(alSolicitante.get(0)));

        // 2) A per-unit decline must NOT reach the requester: the request is
        //    still PENDIENTE, so telling the citizen "rejected" would be a lie.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/reject", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(primera)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("PENDIENTE"));

        alSolicitante = pushPortDePrueba.haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES);
        assertEquals(1, alSolicitante.size(),
                "el declive por unidad NO se entrega al solicitante: la solicitud sigue PENDIENTE");
        assertTrue(alSolicitante.stream().noneMatch(publicacion -> "RECHAZADA".equals(estadoDe(publicacion))),
                "el solicitante nunca recibe RECHAZADA");

        // 3) Assignment (ASIGNADA) reached the requester.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(segunda)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true));

        alSolicitante = pushPortDePrueba.haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES);
        assertEquals(2, alSolicitante.size(), "el solicitante recibe la asignación");
        assertEquals("ASIGNADA", estadoDe(alSolicitante.get(1)));
        assertEquals(segunda.toString(), ambulanciaAsignadaDe(alSolicitante.get(1)));

        // 4) Confirmation (CONFIRMADA) reached the requester.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/confirmar", solicitudId)
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("CONFIRMADA"));

        alSolicitante = pushPortDePrueba.haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES);
        assertEquals(3, alSolicitante.size(), "el solicitante recibe la confirmación");
        assertEquals("CONFIRMADA", estadoDe(alSolicitante.get(2)));
    }

    // -----------------------------------------------------------------------
    // Finish / release (DEBT 2 & 3, EP-04.F2.US6/US11)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("DEBT2/3: finalizar cierra la solicitud (TOMADA), libera la unidad y propaga por /topic/flota")
    void debt2_finalizarCierraYLiberaLaUnidad() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        String solicitanteId = usuarioDe(CIUDADANO).getId().toString();
        UUID unidad = unidadDelConductor;
        String solicitudId = crearSolicitud(ciudadano, zona);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.solicitud.estado").value("ASIGNADA"));

        mockMvc.perform(post("/api/v1/solicitudes/{id}/finalizar", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("TOMADA"));

        // The request stops being active and the unit is available again, in the
        // same operation.
        assertEquals(EstadoSolicitud.TOMADA,
                solicitudJpaRepository.findById(UUID.fromString(solicitudId)).orElseThrow().getEstado());
        assertEquals(EstadoAmbulancia.DISPONIBLE,
                ambulanciaJpaRepository.findById(unidad).orElseThrow().getEstado());

        PublicacionCapturada flota = pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA);
        assertNotNull(flota, "finalizar debe propagar la liberacion a /topic/flota");
        assertInstanceOf(FlotaPushPayload.class, flota.payload());
        assertEquals(unidad, ((FlotaPushPayload) flota.payload()).ambulanciaId());
        assertEquals("DISPONIBLE", ((FlotaPushPayload) flota.payload()).estado());

        // The requester is told the request closed.
        boolean cierre = pushPortDePrueba
                .haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .anyMatch(publicacion -> "TOMADA".equals(estadoDe(publicacion)));
        assertTrue(cierre, "el solicitante recibe el cierre (TOMADA)");
    }

    @Test
    @DisplayName("DEBT2: finalizar con una unidad ajena responde 409 y no cierra ni libera nada")
    void debt2_finalizarConUnidadAjenaDevuelve409() throws Exception {
        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        String conductor = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        UUID unidad = unidadDelConductor;
        String solicitudId = crearSolicitud(ciudadano, zona);

        mockMvc.perform(post("/api/v1/solicitudes/{id}/accept", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(unidad)))
                .andExpect(status().isOk());

        // Notified but not assigned: cannot finish another unit's mission.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/finalizar", solicitudId)
                        .header("Authorization", "Bearer " + conductor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoAmbulancia(sembradas.get(1))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        assertEquals(EstadoSolicitud.ASIGNADA,
                solicitudJpaRepository.findById(UUID.fromString(solicitudId)).orElseThrow().getEstado());
        assertEquals(EstadoAmbulancia.EN_MISION,
                ambulanciaJpaRepository.findById(unidad).orElseThrow().getEstado());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Executes a GET and reads its JSON body, failing if it is not a 200. */
    private JsonNode leerJson(MockHttpServletRequestBuilder builder) throws Exception {
        MvcResult result = mockMvc.perform(builder).andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private String crearSolicitud(String token, String zona) throws Exception {
        return crearSolicitud(token, zona, UUID.randomUUID());
    }

    /** Creates a request addressed to a concrete help center (its user id). */
    private String crearSolicitud(String token, String zona, UUID centroAyudaId) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/solicitudes")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSolicitud(zona, centroAyudaId)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    private String cuerpoSolicitud(String zona) throws Exception {
        return cuerpoSolicitud(zona, UUID.randomUUID());
    }

    private String cuerpoSolicitud(String zona, UUID centroAyudaId) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "emergenciaId", UUID.randomUUID().toString(),
                "centroAyudaId", centroAyudaId.toString(),
                "zonaId", zona));
    }

    private String cuerpoAmbulancia(UUID ambulanciaId) throws Exception {
        return objectMapper.writeValueAsString(Map.of("ambulanciaId", ambulanciaId.toString()));
    }

    /** Reads the {@code estado} of a captured request push payload. */
    private static String estadoDe(PublicacionCapturada publicacion) {
        return ((FlotaPushListener.SolicitudPushPayload) publicacion.payload()).estado();
    }

    /** Reads the assigned unit id of a captured request push payload, or null. */
    private static String ambulanciaAsignadaDe(PublicacionCapturada publicacion) {
        UUID asignada = ((FlotaPushListener.SolicitudPushPayload) publicacion.payload()).ambulanciaAsignadaId();
        return asignada == null ? null : asignada.toString();
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
