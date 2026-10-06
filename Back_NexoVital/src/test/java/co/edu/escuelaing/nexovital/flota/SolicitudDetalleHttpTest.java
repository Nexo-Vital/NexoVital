package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.UsuarioJpaEntity;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP cases of the authoritative request detail (EP-04.F2.US3,
 * {@code GET /api/v1/solicitudes/{id}}).
 *
 * <p>Covers the private-read rule: the requester gets 200, the driver of the
 * assigned unit or of a notified unit gets 200, and anyone else gets 403
 * {@code SOLICITUD_AJENA}; an unknown id gets 404 {@code SOLICITUD_NO_ENCONTRADA}
 * and a missing token gets 401. Each test seeds its OWN actors and units, so the
 * shared H2 fleet cannot contaminate the assertion.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudDetalleHttpTest extends LoginTestBase {

    private static final String PASSWORD = "detalle123";

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private SolicitudJpaRepository solicitudJpaRepository;

    @Autowired
    private PasswordEncoderPort passwordEncoderPort;

    private UUID solicitanteId;
    private String solicitanteEmail;
    private String otroCiudadanoEmail;

    private String conductorNotificadoEmail;
    private UUID unidadNotificada;

    private String conductorAjenoEmail;
    private UUID unidadAjena;

    private String zona;
    private final List<UUID> usuarios = new ArrayList<>();
    private final List<UUID> ambulancias = new ArrayList<>();
    private final List<UUID> solicitudes = new ArrayList<>();

    @BeforeEach
    void sembrarActores() {
        zona = "Detalle-" + UUID.randomUUID();

        solicitanteId = UUID.randomUUID();
        solicitanteEmail = "solicitante-detalle-" + UUID.randomUUID() + "@nexovital.co";
        otroCiudadanoEmail = "ciudadano-detalle-" + UUID.randomUUID() + "@nexovital.co";
        sembrarUsuario(solicitanteId, "Solicitante Detalle", solicitanteEmail, RolUsuario.CIUDADANO);
        sembrarUsuario(UUID.randomUUID(), "Ciudadano Detalle", otroCiudadanoEmail, RolUsuario.CIUDADANO);

        UUID conductorNotificadoId = UUID.randomUUID();
        conductorNotificadoEmail = "conductor-notif-" + UUID.randomUUID() + "@nexovital.co";
        sembrarUsuario(conductorNotificadoId, "Conductor Notificado", conductorNotificadoEmail,
                RolUsuario.CONDUCTOR);
        unidadNotificada = sembrarAmbulancia("DTL1", conductorNotificadoId);

        UUID conductorAjenoId = UUID.randomUUID();
        conductorAjenoEmail = "conductor-ajeno-" + UUID.randomUUID() + "@nexovital.co";
        sembrarUsuario(conductorAjenoId, "Conductor Ajeno", conductorAjenoEmail, RolUsuario.CONDUCTOR);
        // Seeded but NEVER part of the requests' notified set (unless a test
        // explicitly assigns it), so its driver is the "not involved" driver.
        unidadAjena = sembrarAmbulancia("DTL2", conductorAjenoId);
    }

    @AfterEach
    void limpiar() {
        solicitudJpaRepository.deleteAllById(solicitudes);
        solicitudes.clear();
        ambulanciaJpaRepository.deleteAllById(ambulancias);
        ambulancias.clear();
        usuarioJpaRepository.deleteAllById(usuarios);
        usuarios.clear();
    }

    // -----------------------------------------------------------------------
    // 200 — the requester
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("El solicitante obtiene 200 con el detalle autoritativo de su solicitud")
    void solicitanteObtieneDetalle() throws Exception {
        UUID solicitudId = sembrarSolicitud(null, List.of(unidadNotificada));

        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + tokenDe(solicitanteEmail)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(solicitudId.toString()))
                .andExpect(jsonPath("$.estado").value("PENDIENTE"))
                .andExpect(jsonPath("$.ubicacion.lat").value(4.73d))
                .andExpect(jsonPath("$.ubicacion.lng").value(-74.08d))
                .andExpect(jsonPath("$.ambulanciasNotificadas[0]").value(unidadNotificada.toString()))
                // EP-04.F2.US4: the retry counter rides the detail DTO (0 here).
                .andExpect(jsonPath("$.reintentos").value(0));
    }

    // -----------------------------------------------------------------------
    // 200 — an involved driver
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("El conductor de una unidad notificada obtiene 200")
    void conductorNotificadoObtieneDetalle() throws Exception {
        UUID solicitudId = sembrarSolicitud(null, List.of(unidadNotificada));

        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + tokenDe(conductorNotificadoEmail)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(solicitudId.toString()));
    }

    @Test
    @DisplayName("El conductor de la unidad asignada obtiene 200 aunque no figure como notificada")
    void conductorAsignadoObtieneDetalle() throws Exception {
        UUID solicitudId = sembrarSolicitud(unidadAjena, List.of(unidadNotificada));

        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + tokenDe(conductorAjenoEmail)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(solicitudId.toString()))
                .andExpect(jsonPath("$.estado").value("ASIGNADA"))
                .andExpect(jsonPath("$.ambulanciaAsignadaId").value(unidadAjena.toString()));
    }

    // -----------------------------------------------------------------------
    // 403 — an authenticated caller with no right to read it
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Un conductor NO implicado obtiene 403 SOLICITUD_AJENA")
    void conductorNoNotificadoObtiene403() throws Exception {
        UUID solicitudId = sembrarSolicitud(null, List.of(unidadNotificada));

        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + tokenDe(conductorAjenoEmail)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_AJENA"));
    }

    @Test
    @DisplayName("Otro ciudadano autenticado (no solicitante) obtiene 403 SOLICITUD_AJENA")
    void otroUsuarioObtiene403() throws Exception {
        UUID solicitudId = sembrarSolicitud(null, List.of(unidadNotificada));

        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + tokenDe(otroCiudadanoEmail)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_AJENA"));
    }

    // -----------------------------------------------------------------------
    // 404 — unknown id
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Un id inexistente obtiene 404 SOLICITUD_NO_ENCONTRADA")
    void idInexistenteObtiene404() throws Exception {
        mockMvc.perform(get("/api/v1/solicitudes/{id}", UUID.randomUUID())
                        .header("Authorization", "Bearer " + tokenDe(solicitanteEmail)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ENCONTRADA"));
    }

    // -----------------------------------------------------------------------
    // 401 — fail-closed without a token
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Sin token responde 401 NO_AUTENTICADO")
    void sinTokenDevuelve401() throws Exception {
        UUID solicitudId = sembrarSolicitud(null, List.of(unidadNotificada));

        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Persists a request in the exact assignment/notified state the test needs. */
    private UUID sembrarSolicitud(UUID ambulanciaAsignadaId, List<UUID> notificadas) {
        UUID id = UUID.randomUUID();
        Instant base = Instant.parse("2026-03-01T10:00:00Z");
        EstadoSolicitud estado = ambulanciaAsignadaId == null
                ? EstadoSolicitud.PENDIENTE
                : EstadoSolicitud.ASIGNADA;
        solicitudJpaRepository.save(new SolicitudJpaEntity(
                id, 4.73d, -74.08d, null, estado, null, zona,
                base, base.plusSeconds(600), solicitanteId, notificadas,
                ambulanciaAsignadaId, null, 0));
        solicitudes.add(id);
        return id;
    }

    private UUID sembrarAmbulancia(String placa, UUID conductorId) {
        UUID id = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                id, placa, EstadoAmbulancia.DISPONIBLE, 4.73d, -74.08d, zona, conductorId));
        ambulancias.add(id);
        return id;
    }

    private void sembrarUsuario(UUID id, String nombre, String email, RolUsuario rol) {
        usuarioJpaRepository.save(new UsuarioJpaEntity(
                id, nombre, email, passwordEncoderPort.encriptar(PASSWORD), rol));
        usuarios.add(id);
    }

    private String tokenDe(String email) throws Exception {
        MvcResult login = intentarLogin(email, PASSWORD).andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
