package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP cases of the fleet telemetry route (EP-04.F1.US1).
 *
 * <p>Covers AC1 (a driver reports its OWN unit, persisted), AC2 (a foreign unit
 * is refused with 409 and does NOT move), AC5 (a report does NOT change the
 * unit's state) and AC7 (fail-closed: 401 without a token, 403 with the wrong
 * role). The realtime propagation (AC3/AC4) lives in
 * {@link PosicionPropagacionHttpTest}.
 *
 * <p>Each test seeds its own units in a random zone and deletes them afterwards,
 * because the test H2 is shared and other fleet tests assert the seeded catalog.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class PosicionHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String CONDUCTOR = "conductor1@nexovital.co";
    private static final String CONDUCTOR_PASSWORD = "conductor123";

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    /** The unit driven by the authenticating driver ({@code conductor1}). */
    private UUID unidadPropia;
    /** A unit driven by some other driver: never the caller's. */
    private UUID unidadAjena;

    private String zona;
    private final List<UUID> sembradas = new ArrayList<>();

    @BeforeEach
    void sembrarAmbulanciasDePrueba() {
        zona = "Posicion-" + UUID.randomUUID();
        UUID conductorAutenticado = usuarioDe(CONDUCTOR).getId();

        unidadPropia = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidadPropia, "POS1", EstadoAmbulancia.DISPONIBLE,
                4.73d, -74.08d, zona, conductorAutenticado));
        sembradas.add(unidadPropia);

        unidadAjena = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidadAjena, "POS2", EstadoAmbulancia.DISPONIBLE,
                4.60d, -74.10d, zona, UUID.randomUUID()));
        sembradas.add(unidadAjena);
    }

    @AfterEach
    void limpiar() {
        ambulanciaJpaRepository.deleteAllById(sembradas);
        sembradas.clear();
    }

    // -----------------------------------------------------------------------
    // AC1 — the driver reports its OWN unit and it is persisted
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC1: el conductor reporta la posición de su unidad, responde 200 y queda persistida")
    void ac1_elConductorReportaLaPosicionDeSuUnidad() throws Exception {
        String token = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);

        mockMvc.perform(post("/api/v1/flota/ambulancias/{id}/posicion", unidadPropia)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoPosicion(4.74d, -74.09d, 90)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(unidadPropia.toString()))
                .andExpect(jsonPath("$.ubicacion.lat").value(4.74d))
                .andExpect(jsonPath("$.ubicacion.lng").value(-74.09d))
                // Never exposes the driver id, exactly like the fleet reads.
                .andExpect(jsonPath("$.conductorId").doesNotExist());

        AmbulanciaJpaEntity persistida = ambulanciaJpaRepository.findById(unidadPropia).orElseThrow();
        assertEquals(4.74d, persistida.getLat());
        assertEquals(-74.09d, persistida.getLng());
    }

    // -----------------------------------------------------------------------
    // AC2 — a foreign unit is refused with 409 and never moves
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC2: reportar la posición de una unidad ajena responde 409 y no la mueve")
    void ac2_reportarUnaUnidadAjenaDevuelve409() throws Exception {
        String token = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);

        mockMvc.perform(post("/api/v1/flota/ambulancias/{id}/posicion", unidadAjena)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoPosicion(4.99d, -73.99d, 10)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("AMBULANCIA_AJENA"));

        AmbulanciaJpaEntity ajena = ambulanciaJpaRepository.findById(unidadAjena).orElseThrow();
        assertEquals(4.60d, ajena.getLat(), "una unidad ajena no se mueve");
        assertEquals(-74.10d, ajena.getLng(), "una unidad ajena no se mueve");
    }

    // -----------------------------------------------------------------------
    // AC5 — position is data, not a state
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC5: actualizar la posición NO cambia el estado de la ambulancia")
    void ac5_actualizarPosicionNoCambiaElEstado() throws Exception {
        String token = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);
        // A busy unit keeps moving: set it EN_MISION before the report.
        AmbulanciaJpaEntity enMision = ambulanciaJpaRepository.findById(unidadPropia).orElseThrow();
        enMision.setEstado(EstadoAmbulancia.EN_MISION);
        ambulanciaJpaRepository.save(enMision);

        mockMvc.perform(post("/api/v1/flota/ambulancias/{id}/posicion", unidadPropia)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoPosicion(4.75d, -74.07d, 45)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("EN_MISION"));

        AmbulanciaJpaEntity actualizada = ambulanciaJpaRepository.findById(unidadPropia).orElseThrow();
        assertEquals(EstadoAmbulancia.EN_MISION, actualizada.getEstado(),
                "reportar la posición no puede cambiar el estado");
        assertEquals(4.75d, actualizada.getLat(), "pero la posición sí cambia");
    }

    // -----------------------------------------------------------------------
    // AC7 — fail-closed on the new route
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC7: sin token, reportar la posición responde 401")
    void ac7_sinTokenDevuelve401() throws Exception {
        mockMvc.perform(post("/api/v1/flota/ambulancias/{id}/posicion", unidadPropia)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoPosicion(4.74d, -74.09d, 0)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    @DisplayName("AC7: un CIUDADANO no puede reportar posición (403), la ruta exige CONDUCTOR")
    void ac7_rolIncorrectoDevuelve403() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/flota/ambulancias/{id}/posicion", unidadPropia)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoPosicion(4.74d, -74.09d, 0)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    @Test
    @DisplayName("El reporte sin ubicación responde 400 y no mueve la unidad")
    void sinUbicacionDevuelve400() throws Exception {
        String token = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);

        mockMvc.perform(post("/api/v1/flota/ambulancias/{id}/posicion", unidadPropia)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"heading\": 10}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        assertEquals(4.73d, ambulanciaJpaRepository.findById(unidadPropia).orElseThrow().getLat());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private String cuerpoPosicion(double lat, double lng, int heading) throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("ubicacion", Map.of("lat", lat, "lng", lng));
        cuerpo.put("heading", heading);
        return objectMapper.writeValueAsString(cuerpo);
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
