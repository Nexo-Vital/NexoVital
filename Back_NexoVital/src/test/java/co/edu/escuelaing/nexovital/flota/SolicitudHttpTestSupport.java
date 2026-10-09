package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.application.usecase.SolicitudAbiertaPushListener.SolicitudAbiertaPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.UsuarioJpaEntity;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Shared scenario of the HTTP tests of EP-04.F2.US1.
 *
 * <p><b>Each test owns its drivers.</b> The seeded drivers cannot be used here:
 * the routes under {@code /ambulancias/mia} resolve "my unit" from the driver,
 * and a seeded driver already drives a seeded unit. Every driver of these tests
 * is a fresh user with exactly one fresh unit, so "my unit" is unambiguous.
 *
 * <p><b>The database is shared.</b> The five seeded units are connected and
 * available, so they are notified of every request too, and other test classes
 * leave requests behind. The assertions therefore talk about the units and the
 * requests this test created, never about "the only ones".
 *
 * <p>Everything created through these helpers is deleted after each test.
 */
abstract class SolicitudHttpTestSupport extends LoginTestBase {

    protected static final String CIUDADANO = "ciudadano@nexovital.co";
    protected static final String CIUDADANO_PASSWORD = "ciudadano123";
    protected static final String CLAVE_CONDUCTOR = "conductor-prueba-123";

    @Autowired
    protected AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    protected SolicitudJpaRepository solicitudJpaRepository;

    @Autowired
    protected PushPortDePrueba pushPortDePrueba;

    @Autowired
    protected PasswordEncoderPort passwordEncoderPort;

    /** A driver of the test and the single unit it drives. */
    protected record Conductor(UUID id, String email, UUID unidad) {
    }

    protected String zona;

    private final List<UUID> usuariosCreados = new ArrayList<>();
    private final List<UUID> unidadesCreadas = new ArrayList<>();
    private final List<UUID> solicitudesCreadas = new ArrayList<>();

    @BeforeEach
    void prepararEscenario() {
        zona = "PruebaUS1-" + UUID.randomUUID();
        pushPortDePrueba.limpiar();
    }

    @AfterEach
    void limpiarEscenario() {
        solicitudJpaRepository.deleteAllById(solicitudesCreadas);
        solicitudesCreadas.clear();
        ambulanciaJpaRepository.deleteAllById(unidadesCreadas);
        unidadesCreadas.clear();
        usuarioJpaRepository.deleteAllById(usuariosCreados);
        usuariosCreados.clear();
        pushPortDePrueba.limpiar();
    }

    // -----------------------------------------------------------------------
    // Scenario
    // -----------------------------------------------------------------------

    /**
     * Creates a driver and its unit in the given state. The unit is born
     * connected and with signal, like every unit.
     */
    protected Conductor sembrarConductor(EstadoAmbulancia estado) {
        UUID conductorId = UUID.randomUUID();
        String email = "conductor-prueba-" + conductorId + "@nexovital.co";
        usuarioJpaRepository.save(new UsuarioJpaEntity(conductorId, "Conductor de prueba", email,
                passwordEncoderPort.encriptar(CLAVE_CONDUCTOR), RolUsuario.CONDUCTOR));
        usuariosCreados.add(conductorId);

        UUID unidad = UUID.randomUUID();
        String placa = "T" + unidad.toString().substring(0, 7).toUpperCase();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidad, placa, estado, 4.73d, -74.08d, zona, conductorId));
        unidadesCreadas.add(unidad);
        return new Conductor(conductorId, email, unidad);
    }

    /** Disconnects a unit directly in the database, without going through the command. */
    protected void desconectarEnBase(UUID unidad) {
        jdbcTemplate.update("UPDATE ambulancias SET conectada = false WHERE id = '" + unidad + "'");
    }

    /** Leaves a unit without signal directly in the database. */
    protected void dejarSinSenalEnBase(UUID unidad) {
        jdbcTemplate.update("UPDATE ambulancias SET sin_senal = true WHERE id = '" + unidad + "'");
    }

    protected AmbulanciaJpaEntity unidadEnBase(UUID unidad) {
        return ambulanciaJpaRepository.findById(unidad).orElseThrow();
    }

    /** How many times a unit appears among the notified units of a request (0 or 1). */
    protected int vecesNotificada(UUID solicitudId, UUID unidad) {
        Integer veces = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM solicitud_ambulancia_notificadas WHERE solicitud_id = '" + solicitudId
                        + "' AND ambulancia_id = '" + unidad + "'", Integer.class);
        return veces == null ? 0 : veces;
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    protected String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }

    protected String tokenDe(Conductor conductor) throws Exception {
        return tokenDe(conductor.email(), CLAVE_CONDUCTOR);
    }

    protected String tokenCiudadano() throws Exception {
        return tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
    }

    /** {@code POST /api/v1/solicitudes} with a valid pickup point. */
    protected ResultActions solicitar(String token) throws Exception {
        return mockMvc.perform(post("/api/v1/solicitudes")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "ubicacion", Map.of("lat", 4.73d, "lng", -74.08d),
                        "zonaId", zona))));
    }

    /** Creates a request, expects 201 and returns its JSON. It is deleted after the test. */
    protected JsonNode crearSolicitud(String token) throws Exception {
        MvcResult result = solicitar(token).andExpect(status().isCreated()).andReturn();
        JsonNode creada = objectMapper.readTree(result.getResponse().getContentAsString());
        solicitudesCreadas.add(UUID.fromString(creada.get("id").asText()));
        return creada;
    }

    protected static UUID idDe(JsonNode solicitud) {
        return UUID.fromString(solicitud.get("id").asText());
    }

    protected static Set<UUID> notificadasDe(JsonNode solicitud) {
        Set<UUID> notificadas = new HashSet<>();
        for (JsonNode id : solicitud.get("ambulanciasNotificadas")) {
            notificadas.add(UUID.fromString(id.asText()));
        }
        return notificadas;
    }

    /** {@code POST /api/v1/solicitudes/{id}/{accion}} with the driver's own unit. */
    protected ResultActions responder(String accion, UUID solicitudId, Conductor conductor, String token)
            throws Exception {
        return mockMvc.perform(post("/api/v1/solicitudes/{id}/" + accion, solicitudId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("ambulanciaId", conductor.unidad().toString()))));
    }

    /** The requester confirms the arrival, the step that enables finishing. */
    protected ResultActions confirmarLlegada(UUID solicitudId, String tokenCiudadano) throws Exception {
        return mockMvc.perform(post("/api/v1/solicitudes/{id}/confirmar", solicitudId)
                .header("Authorization", "Bearer " + tokenCiudadano));
    }

    /** {@code POST /api/v1/flota/ambulancias/mia/{comando}} without a body. */
    protected ResultActions comandoDeMiUnidad(String comando, String token) throws Exception {
        return mockMvc.perform(post("/api/v1/flota/ambulancias/mia/" + comando)
                .header("Authorization", "Bearer " + token));
    }

    /** {@code POST /api/v1/flota/ambulancias/mia/disponibilidad}. */
    protected ResultActions declararDisponibilidad(boolean disponible, String token) throws Exception {
        return mockMvc.perform(post("/api/v1/flota/ambulancias/mia/disponibilidad")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("disponible", disponible))));
    }

    /** Ids the pending-requests read returns to a driver. */
    protected Set<UUID> pendientesDe(String token) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/flota/ambulancias/mia/solicitudes/pendientes")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        Set<UUID> ids = new HashSet<>();
        String cuerpo = result.getResponse().getContentAsString();
        if (cuerpo == null || cuerpo.isBlank()) {
            return ids;
        }
        JsonNode pendientes = objectMapper.readTree(cuerpo);
        if (pendientes != null && pendientes.isArray()) {
            for (JsonNode pendiente : pendientes) {
                ids.add(UUID.fromString(pendiente.get("id").asText()));
            }
        }
        return ids;
    }

    // -----------------------------------------------------------------------
    // Pushes
    // -----------------------------------------------------------------------

    /** Request frames a driver received for one request, with the given state. */
    protected List<SolicitudPushPayload> framesDe(Conductor conductor, UUID solicitudId, String estado) {
        List<SolicitudPushPayload> frames = new ArrayList<>();
        for (PublicacionCapturada publicacion : pushPortDePrueba.haciaUsuario(
                conductor.id().toString(), FlotaPushListener.DESTINO_SOLICITUDES)) {
            if (publicacion.payload() instanceof SolicitudPushPayload payload
                    && solicitudId.equals(payload.solicitudId())
                    && estado.equals(payload.estado())) {
                frames.add(payload);
            }
        }
        return frames;
    }

    /** True when the driver received the broadcast of a NEW request. */
    protected boolean recibioSolicitudNueva(Conductor conductor, UUID solicitudId) {
        return !framesDe(conductor, solicitudId, "PENDIENTE").isEmpty();
    }

    /** Late offers a driver received for one request (the frame with the two instants). */
    protected List<SolicitudAbiertaPushPayload> ofertasTardiasDe(Conductor conductor, UUID solicitudId) {
        List<SolicitudAbiertaPushPayload> ofertas = new ArrayList<>();
        for (PublicacionCapturada publicacion : pushPortDePrueba.haciaUsuario(
                conductor.id().toString(), FlotaPushListener.DESTINO_SOLICITUDES)) {
            if (publicacion.payload() instanceof SolicitudAbiertaPushPayload payload
                    && solicitudId.equals(payload.solicitudId())) {
                ofertas.add(payload);
            }
        }
        return ofertas;
    }
}
