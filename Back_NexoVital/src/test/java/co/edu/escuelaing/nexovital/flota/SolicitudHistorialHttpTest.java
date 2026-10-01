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
import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP cases of the driver's own-unit service history (task CON-3,
 * {@code GET /api/v1/flota/ambulancias/mia/solicitudes}).
 *
 * <p>Covers: only requests ASSIGNED to the caller's unit appear (PENDIENTE,
 * CANCELADA, TIMEOUT and another unit's requests never do), newest first, the
 * DTO carries the state/assigned unit/arrival, a unit with no history answers an
 * empty array, a driver with no unit mirrors {@code /mia}, and the route is
 * fail-closed (401 without a token, 403 with the wrong role).
 *
 * <p>Each test creates its OWN driver and units, so the shared H2 and the seeded
 * fleet of other tests can never contaminate the assertion.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudHistorialHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String CONDUCTOR_PASSWORD = "historial123";

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private SolicitudJpaRepository solicitudJpaRepository;

    @Autowired
    private PasswordEncoderPort passwordEncoderPort;

    private UUID conductorId;
    private String conductorEmail;
    private UUID unidadPropia;
    private UUID unidadAjena;

    private String zona;
    private final List<UUID> ambulancias = new ArrayList<>();
    private final List<UUID> solicitudes = new ArrayList<>();

    @BeforeEach
    void sembrarConductorYUnidades() {
        zona = "Historial-" + UUID.randomUUID();
        conductorId = UUID.randomUUID();
        conductorEmail = "conductor-historial-" + UUID.randomUUID() + "@nexovital.co";
        usuarioJpaRepository.save(new UsuarioJpaEntity(conductorId, "Conductor Historial", conductorEmail,
                passwordEncoderPort.encriptar(CONDUCTOR_PASSWORD), RolUsuario.CONDUCTOR));

        unidadPropia = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidadPropia, "HIS1", EstadoAmbulancia.DISPONIBLE, 4.73d, -74.08d, zona, conductorId));
        ambulancias.add(unidadPropia);

        unidadAjena = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidadAjena, "HIS2", EstadoAmbulancia.DISPONIBLE, 4.60d, -74.10d, zona, UUID.randomUUID()));
        ambulancias.add(unidadAjena);
    }

    @AfterEach
    void limpiar() {
        solicitudJpaRepository.deleteAllById(solicitudes);
        solicitudes.clear();
        ambulanciaJpaRepository.deleteAllById(ambulancias);
        ambulancias.clear();
        if (conductorId != null) {
            usuarioJpaRepository.deleteById(conductorId);
        }
    }

    @Test
    @DisplayName("El historial trae SOLO los servicios asignados a la unidad propia, del mas nuevo al mas viejo")
    void historialSoloConServiciosAsignadosYMasNuevosPrimero() throws Exception {
        String token = tokenDe(conductorEmail, CONDUCTOR_PASSWORD);
        Instant base = Instant.parse("2026-03-01T10:00:00Z");

        UUID asignadaNueva = sembrarSolicitud(EstadoSolicitud.ASIGNADA, base.plusSeconds(300),
                unidadPropia, base.plusSeconds(330));
        UUID asignadaVieja = sembrarSolicitud(EstadoSolicitud.TOMADA, base, unidadPropia, null);
        UUID pendiente = sembrarSolicitud(EstadoSolicitud.PENDIENTE, base.plusSeconds(900), null, null);
        UUID cancelada = sembrarSolicitud(EstadoSolicitud.CANCELADA, base.plusSeconds(1000), null, null);
        UUID expirada = sembrarSolicitud(EstadoSolicitud.TIMEOUT, base.plusSeconds(1100), null, null);
        UUID ajena = sembrarSolicitud(EstadoSolicitud.ASIGNADA, base.plusSeconds(1200), unidadAjena, null);

        MvcResult result = mockMvc.perform(get("/api/v1/flota/ambulancias/mia/solicitudes")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].id").value(asignadaNueva.toString()))
                .andExpect(jsonPath("$[1].id").value(asignadaVieja.toString()))
                .andExpect(jsonPath("$[0].estado").value("ASIGNADA"))
                .andExpect(jsonPath("$[1].estado").value("TOMADA"))
                .andExpect(jsonPath("$[0].ambulanciaAsignadaId").value(unidadPropia.toString()))
                .andExpect(jsonPath("$[1].ambulanciaAsignadaId").value(unidadPropia.toString()))
                .andExpect(jsonPath("$[0].llegadaEn").isNotEmpty())
                .andExpect(jsonPath("$[0].ubicacion.lat").value(4.73d))
                .andReturn();

        JsonNode historial = objectMapper.readTree(result.getResponse().getContentAsString());
        Set<String> ids = new HashSet<>();
        for (JsonNode entrada : historial) {
            ids.add(entrada.get("id").asText());
        }
        assertFalse(ids.contains(pendiente.toString()), "una solicitud solo difundida no es historial");
        assertFalse(ids.contains(cancelada.toString()), "una solicitud cancelada no es historial");
        assertFalse(ids.contains(expirada.toString()), "una solicitud expirada no es historial");
        assertFalse(ids.contains(ajena.toString()), "una solicitud de otra unidad no es historial");
    }

    @Test
    @DisplayName("Una unidad sin servicios atendidos devuelve un arreglo vacio")
    void unidadSinHistorialDevuelveArregloVacio() throws Exception {
        String token = tokenDe(conductorEmail, CONDUCTOR_PASSWORD);

        mockMvc.perform(get("/api/v1/flota/ambulancias/mia/solicitudes")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    @DisplayName("Un conductor sin unidad responde igual que /mia (mismo 200 y mismo cuerpo)")
    void conductorSinUnidadRespondeIgualQueMia() throws Exception {
        UUID sinUnidadId = UUID.randomUUID();
        String email = "conductor-sin-unidad-" + UUID.randomUUID() + "@nexovital.co";
        usuarioJpaRepository.save(new UsuarioJpaEntity(sinUnidadId, "Conductor Sin Unidad", email,
                passwordEncoderPort.encriptar("sinunidad123"), RolUsuario.CONDUCTOR));
        try {
            String token = tokenDe(email, "sinunidad123");

            MvcResult mia = mockMvc.perform(get("/api/v1/flota/ambulancias/mia")
                            .header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andReturn();
            MvcResult historial = mockMvc.perform(get("/api/v1/flota/ambulancias/mia/solicitudes")
                            .header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andReturn();

            assertEquals(mia.getResponse().getContentAsString(),
                    historial.getResponse().getContentAsString(),
                    "sin unidad, el historial debe responder igual que /mia");
        } finally {
            usuarioJpaRepository.deleteById(sinUnidadId);
        }
    }

    @Test
    @DisplayName("La ruta es fail-closed: sin token responde 401 y un CIUDADANO responde 403")
    void rutaFailClosed() throws Exception {
        mockMvc.perform(get("/api/v1/flota/ambulancias/mia/solicitudes"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));

        String ciudadano = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        mockMvc.perform(get("/api/v1/flota/ambulancias/mia/solicitudes")
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    /** Persists a request in an exact state/assignment, tracked for cleanup. */
    private UUID sembrarSolicitud(EstadoSolicitud estado, Instant solicitadaEn,
                                  UUID ambulanciaAsignadaId, Instant llegadaEn) {
        UUID id = UUID.randomUUID();
        solicitudJpaRepository.save(new SolicitudJpaEntity(
                id, 4.73d, -74.08d, null, estado, null, zona, solicitadaEn,
                solicitadaEn.plusSeconds(600), UUID.randomUUID(), List.of(),
                ambulanciaAsignadaId, llegadaEn));
        solicitudes.add(id);
        return id;
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
