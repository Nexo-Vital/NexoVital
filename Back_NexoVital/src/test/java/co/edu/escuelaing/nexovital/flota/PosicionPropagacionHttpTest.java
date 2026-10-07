package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.PosicionPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
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
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Realtime propagation of a reported position (EP-04.F1.US1).
 *
 * <p>Covers AC3 (the frame reaches {@code /topic/flota} with the front's
 * {@code LiveUnitPayload} shape) and AC4 (the push happens AFTER commit, never
 * inside the transaction). The report, ownership and state rules live in
 * {@link PosicionHttpTest}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class PosicionPropagacionHttpTest extends LoginTestBase {

    private static final String CONDUCTOR = "conductor1@nexovital.co";
    private static final String CONDUCTOR_PASSWORD = "conductor123";

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    @Autowired
    private ReportarPosicionUseCase reportarPosicionUseCase;

    @Autowired
    private TransactionTemplate transactionTemplate;

    private UUID unidadPropia;
    private final List<UUID> sembradas = new ArrayList<>();

    @BeforeEach
    void sembrarAmbulanciaDePrueba() {
        pushPortDePrueba.limpiar();
        String zona = "Propagacion-" + UUID.randomUUID();
        unidadPropia = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidadPropia, "PRP1", EstadoAmbulancia.DISPONIBLE,
                4.73d, -74.08d, zona, usuarioDe(CONDUCTOR).getId()));
        sembradas.add(unidadPropia);
    }

    @AfterEach
    void limpiar() {
        ambulanciaJpaRepository.deleteAllById(sembradas);
        sembradas.clear();
        pushPortDePrueba.limpiar();
    }

    // -----------------------------------------------------------------------
    // AC3 — propagation on /topic/flota with the front's LiveUnitPayload shape
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC3: la posición se propaga por /topic/flota con la forma que el front consume")
    void ac3_laPosicionSePropagaPorTopicFlotaConLaFormaDelFront() throws Exception {
        String token = tokenDe(CONDUCTOR, CONDUCTOR_PASSWORD);

        mockMvc.perform(post("/api/v1/flota/ambulancias/{id}/posicion", unidadPropia)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("ubicacion",
                                Map.of("lat", 4.741d, "lng", -74.081d), "heading", 135))))
                .andExpect(status().isOk());

        PublicacionCapturada flota = pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA);
        assertNotNull(flota, "reportar la posición debe propagarse a /topic/flota");
        assertInstanceOf(PosicionPushPayload.class, flota.payload());
        PosicionPushPayload payload = (PosicionPushPayload) flota.payload();

        assertEquals(unidadPropia, payload.ambulanceId());
        assertEquals(4.741d, payload.ubicacion().lat());
        assertEquals(-74.081d, payload.ubicacion().lng());
        // The front's `AmbulanceState` is English, not the domain's Spanish enum.
        assertEquals("AVAILABLE", payload.estado());
        assertEquals(135, payload.heading());
        assertEquals("device", payload.source());

        // The wire shape is EXACTLY the front's LiveUnitPayload: same keys, nested
        // `ubicacion: {lat, lng}`, and no discriminant.
        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(payload));
        Set<String> claves = new LinkedHashSet<>();
        json.fieldNames().forEachRemaining(claves::add);
        assertEquals(Set.of("ambulanceId", "ubicacion", "estado", "heading", "source",
                "sinSenal", "ultimaPosicionEn", "version"), claves,
                "el payload debe exponer exactamente las claves de LiveUnitPayload");
        Set<String> clavesUbicacion = new LinkedHashSet<>();
        json.get("ubicacion").fieldNames().forEachRemaining(clavesUbicacion::add);
        assertEquals(Set.of("lat", "lng"), clavesUbicacion, "ubicacion debe ser {lat, lng}");
    }

    // -----------------------------------------------------------------------
    // AC4 — the push happens AFTER commit
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC4: el push ocurre después del commit, nunca dentro de la transacción")
    void ac4_elPushOcurreDespuesDelCommit() {
        UUID conductorId = usuarioDe(CONDUCTOR).getId();
        pushPortDePrueba.limpiar();

        transactionTemplate.executeWithoutResult(status -> {
            reportarPosicionUseCase.reportarPosicion(
                    unidadPropia, conductorId, 4.742d, -74.082d, 20, FuentePosicion.DEVICE);
            assertEquals(0, pushPortDePrueba.publicaciones().size(),
                    "dentro de la transacción todavía no se publica nada");
        });

        assertEquals(1, pushPortDePrueba.publicaciones().size(),
                "al commitear, el frame salió a /topic/flota");
        assertNotNull(pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA));
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
