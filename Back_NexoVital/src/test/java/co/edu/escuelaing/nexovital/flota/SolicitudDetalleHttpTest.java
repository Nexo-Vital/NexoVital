package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-04.F2.US3 — detail of a request for the driver who was notified of it
 * ({@code GET /api/v1/solicitudes/{id}}).
 *
 * <p>The rule under test: a driver reads a request only when it was notified or
 * assigned to the unit they drive. The unit is resolved from the authenticated
 * driver, never from the client.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudDetalleHttpTest extends SolicitudHttpTestSupport {

    private static Instant alMilisegundo(Instant instante) {
        return instante.truncatedTo(ChronoUnit.MILLIS);
    }

    private static Instant alMilisegundo(String instante) {
        return alMilisegundo(Instant.parse(instante));
    }

    /** {@code GET /api/v1/solicitudes/{id}} with the given token. */
    private ResultActions detalle(UUID solicitudId, String token) throws Exception {
        return mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                .header("Authorization", "Bearer " + token));
    }

    @Test
    @DisplayName("D1: el conductor notificado abre la solicitud y ve la ubicación de origen, los instantes y las unidades avisadas")
    void d1_elConductorNotificadoVeElDetalle() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        JsonNode creada = crearSolicitud(tokenCiudadano());
        assertTrue(notificadasDe(creada).contains(conductor.unidad()),
                "la unidad de la prueba debe estar entre las notificadas");

        MvcResult result = detalle(idDe(creada), tokenDe(conductor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(creada.get("id").asText()))
                .andExpect(jsonPath("$.estado").value("PENDIENTE"))
                .andExpect(jsonPath("$.ubicacion.lat").value(4.73d))
                .andExpect(jsonPath("$.ubicacion.lng").value(-74.08d))
                .andExpect(jsonPath("$.zonaId").value(zona))
                .andExpect(jsonPath("$.ambulanciaAsignadaId").doesNotExist())
                .andReturn();

        JsonNode leida = objectMapper.readTree(result.getResponse().getContentAsString());
        assertEquals(notificadasDe(creada), notificadasDe(leida),
                "el detalle trae las mismas unidades avisadas que la solicitud creada");
        // The two instants the driver's countdown is built from: they are the
        // ones the server stored, so they match the creation response. The
        // creation answers with the clock's nanoseconds and the database keeps
        // microseconds, so both are compared to the millisecond.
        Instant solicitadaEn = Instant.parse(leida.get("solicitadaEn").asText());
        Instant timeoutEn = Instant.parse(leida.get("timeoutEn").asText());
        assertEquals(alMilisegundo(creada.get("solicitadaEn").asText()), alMilisegundo(solicitadaEn));
        assertEquals(alMilisegundo(creada.get("timeoutEn").asText()), alMilisegundo(timeoutEn));
        assertTrue(timeoutEn.isAfter(solicitadaEn), "el límite para responder es posterior a la solicitud");
    }

    @Test
    @DisplayName("D2: un conductor cuya unidad no fue notificada (estaba ocupada) recibe 403 SOLICITUD_NO_NOTIFICADA")
    void d2_laUnidadNoNotificadaRecibe403() throws Exception {
        Conductor notificado = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor ocupado = sembrarConductor(EstadoAmbulancia.EN_MISION);
        JsonNode creada = crearSolicitud(tokenCiudadano());
        assertTrue(notificadasDe(creada).contains(notificado.unidad()));
        assertFalse(notificadasDe(creada).contains(ocupado.unidad()),
                "la unidad ocupada no entra entre las notificadas");

        detalle(idDe(creada), tokenDe(ocupado))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_NOTIFICADA"))
                .andExpect(jsonPath("$.ubicacion").doesNotExist());
    }

    @Test
    @DisplayName("D3: un conductor sin unidad recibe 403 SOLICITUD_NO_NOTIFICADA")
    void d3_elConductorSinUnidadRecibe403() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        // A driver whose unit no longer exists drives no unit at all.
        Conductor sinUnidad = sembrarConductor(EstadoAmbulancia.MANTENIMIENTO);
        ambulanciaJpaRepository.deleteById(sinUnidad.unidad());
        JsonNode creada = crearSolicitud(tokenCiudadano());

        detalle(idDe(creada), tokenDe(sinUnidad))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_NOTIFICADA"));
    }

    @Test
    @DisplayName("D4: una solicitud que no existe responde 404 SOLICITUD_NO_ENCONTRADA")
    void d4_laSolicitudInexistenteResponde404() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);

        detalle(UUID.randomUUID(), tokenDe(conductor))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ENCONTRADA"));
    }

    @Test
    @DisplayName("D5: sin sesión responde 401, y un ciudadano recibe 403 porque la ruta es del conductor")
    void d5_sinSesionYRolIncorrecto() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();
        JsonNode creada = crearSolicitud(ciudadano);

        mockMvc.perform(get("/api/v1/solicitudes/{id}", idDe(creada)))
                .andExpect(status().isUnauthorized());

        detalle(idDe(creada), ciudadano)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    @Test
    @DisplayName("D6: tras aceptar, la unidad asignada y la que perdió siguen leyendo la solicitud, ya ASIGNADA")
    void d6_despuesDeAceptarElDetalleDiceQuienLaTomo() throws Exception {
        Conductor ganador = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor perdedor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        JsonNode creada = crearSolicitud(tokenCiudadano());
        String tokenGanador = tokenDe(ganador);

        responder("accept", idDe(creada), ganador, tokenGanador).andExpect(status().isOk());

        detalle(idDe(creada), tokenGanador)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("ASIGNADA"))
                .andExpect(jsonPath("$.ambulanciaAsignadaId").value(ganador.unidad().toString()));
        // The unit that lost was notified: it can still read the request and
        // learn that another unit took it.
        detalle(idDe(creada), tokenDe(perdedor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("ASIGNADA"))
                .andExpect(jsonPath("$.ambulanciaAsignadaId").value(ganador.unidad().toString()));
    }
}
