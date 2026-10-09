package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-04.F2.US8 — the assigned driver declares the arrival and the server
 * records it with its own date and time ({@code POST /api/v1/solicitudes/{id}/llegada}).
 *
 * <p>The rules under test: the arrival time is the server's, it is written once
 * and never moves, only the assigned unit of the authenticated driver can
 * declare it, and the two steps that depend on it (the citizen's confirmation
 * and the driver's "finalizar") are refused until it exists (M-04).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudLlegadaHttpTest extends SolicitudHttpTestSupport {

    private static Instant alMilisegundo(String instante) {
        return Instant.parse(instante).truncatedTo(ChronoUnit.MILLIS);
    }

    private ResultActions confirmar(UUID solicitudId, String tokenCiudadano) throws Exception {
        return mockMvc.perform(post("/api/v1/solicitudes/{id}/confirmar", solicitudId)
                .header("Authorization", "Bearer " + tokenCiudadano));
    }

    /** A request raised by the citizen and accepted by the given driver. */
    private UUID solicitudAceptadaPor(Conductor conductor, String tokenConductor) throws Exception {
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        responder("accept", solicitudId, conductor, tokenConductor).andExpect(status().isOk());
        return solicitudId;
    }

    private long llegadasAlSolicitante(UUID solicitudId) {
        String solicitanteId = usuarioDe(CIUDADANO).getId().toString();
        return pushPortDePrueba.haciaUsuario(solicitanteId, FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .filter(publicacion -> publicacion.payload() instanceof SolicitudPushPayload payload
                        && solicitudId.equals(payload.solicitudId())
                        && payload.llegada())
                .count();
    }

    @Test
    @DisplayName("L1: la llegada queda registrada con la fecha y hora del servidor, y no cambia al repetirla")
    void l1_registraLaFechaYHoraDelServidor() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = solicitudAceptadaPor(conductor, token);

        Instant antes = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        MvcResult result = responder("llegada", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("ASIGNADA"))
                .andReturn();
        Instant despues = Instant.now();

        Instant llegadaEn = alMilisegundo(objectMapper.readTree(result.getResponse().getContentAsString())
                .get("llegadaEn").asText());
        assertFalse(llegadaEn.isBefore(antes), "la hora es la del servidor al recibir la llegada: " + llegadaEn);
        assertFalse(llegadaEn.isAfter(despues), "la hora es la del servidor al recibir la llegada: " + llegadaEn);

        // Stored as answered: the database and the detail carry the same instant.
        Instant guardada = solicitudJpaRepository.findById(solicitudId).orElseThrow().getLlegadaEn();
        assertNotNull(guardada);
        assertEquals(llegadaEn, guardada.truncatedTo(ChronoUnit.MILLIS));
        MvcResult detalle = mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(llegadaEn, alMilisegundo(objectMapper.readTree(detalle.getResponse().getContentAsString())
                .get("llegadaEn").asText()));

        // A repeat (double tap or retry) keeps the first time and does not re-notify.
        MvcResult repetida = responder("llegada", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(llegadaEn, alMilisegundo(objectMapper.readTree(repetida.getResponse().getContentAsString())
                .get("llegadaEn").asText()), "la hora registrada no se mueve");
        assertEquals(1, llegadasAlSolicitante(solicitudId), "el ciudadano recibe la llegada una sola vez");
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado(),
                "llegar no libera la unidad: eso es finalizar");
    }

    @Test
    @DisplayName("L2: sin aceptar, con unidad ajena, sin unidad, sin sesión o con otro rol, la llegada se rechaza y no se registra")
    void l2_casosRechazados() throws Exception {
        Conductor asignado = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor otro = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenAsignado = tokenDe(asignado);
        String tokenOtro = tokenDe(otro);

        // Notified but not accepted yet.
        UUID pendiente = idDe(crearSolicitud(tokenCiudadano()));
        responder("llegada", pendiente, asignado, tokenAsignado)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));
        assertNull(solicitudJpaRepository.findById(pendiente).orElseThrow().getLlegadaEn());

        // Accepted by another unit: the notified driver who lost cannot declare it.
        UUID asignada = solicitudAceptadaPor(asignado, tokenAsignado);
        responder("llegada", asignada, otro, tokenOtro)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        // A driver cannot declare with someone else's unit.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/llegada", asignada)
                        .header("Authorization", "Bearer " + tokenOtro)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("ambulanciaId", asignado.unidad().toString()))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        // Without a unit in the body.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/llegada", asignada)
                        .header("Authorization", "Bearer " + tokenAsignado)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        // A request that does not exist.
        responder("llegada", UUID.randomUUID(), asignado, tokenAsignado)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ENCONTRADA"));

        // Without a session, and with the citizen's role.
        mockMvc.perform(post("/api/v1/solicitudes/{id}/llegada", asignada)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("ambulanciaId", asignado.unidad().toString()))))
                .andExpect(status().isUnauthorized());
        responder("llegada", asignada, asignado, tokenCiudadano())
                .andExpect(status().isForbidden());

        assertNull(solicitudJpaRepository.findById(asignada).orElseThrow().getLlegadaEn(),
                "ningún intento rechazado registra la llegada");
        assertEquals(0, llegadasAlSolicitante(asignada), "ni avisa al ciudadano");
    }

    @Test
    @DisplayName("L3: varias declaraciones simultáneas registran una sola hora y avisan una sola vez")
    void l3_declaracionesSimultaneas() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = solicitudAceptadaPor(conductor, token);

        int hilos = 6;
        CountDownLatch largada = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(hilos);
        try {
            List<Future<MvcResult>> resultados = new ArrayList<>();
            for (int i = 0; i < hilos; i++) {
                Callable<MvcResult> llamada = () -> {
                    largada.await();
                    return responder("llegada", solicitudId, conductor, token).andReturn();
                };
                resultados.add(pool.submit(llamada));
            }
            largada.countDown();

            Set<Instant> horas = new HashSet<>();
            for (Future<MvcResult> resultado : resultados) {
                MvcResult respuesta = resultado.get(30, TimeUnit.SECONDS);
                assertEquals(200, respuesta.getResponse().getStatus(),
                        "cada declaración responde 200: " + respuesta.getResponse().getContentAsString());
                JsonNode cuerpo = objectMapper.readTree(respuesta.getResponse().getContentAsString());
                horas.add(alMilisegundo(cuerpo.get("llegadaEn").asText()));
            }
            assertEquals(1, horas.size(), "todas las respuestas traen la misma hora de llegada: " + horas);
        } finally {
            pool.shutdownNow();
        }

        assertEquals(1, llegadasAlSolicitante(solicitudId), "el ciudadano recibe la llegada una sola vez");
        assertEquals(EstadoSolicitud.ASIGNADA, solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
    }

    @Test
    @DisplayName("L4: el ciudadano no puede confirmar antes de la llegada; después de declararla, sí")
    void l4_confirmarExigeLaLlegada() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        String ciudadano = tokenCiudadano();
        UUID solicitudId = solicitudAceptadaPor(conductor, token);

        confirmar(solicitudId, ciudadano)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("LLEGADA_NO_DECLARADA"));
        assertEquals(EstadoSolicitud.ASIGNADA, solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado(),
                "la confirmación rechazada no cambia nada");

        // Before this rule an early confirmation blocked the arrival forever.
        responder("llegada", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.llegadaEn").isNotEmpty());

        confirmar(solicitudId, ciudadano)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("CONFIRMADA"))
                .andExpect(jsonPath("$.llegadaEn").isNotEmpty());
    }

    @Test
    @DisplayName("L5: el conductor no puede finalizar sin llegada ni sin confirmación; con ambas, sí")
    void l5_finalizarExigeLaLlegada() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = solicitudAceptadaPor(conductor, token);

        responder("finalizar", solicitudId, conductor, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("LLEGADA_NO_DECLARADA"));
        assertEquals(EstadoSolicitud.ASIGNADA, solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado(),
                "sin llegada, la unidad sigue en misión");

        responder("llegada", solicitudId, conductor, token).andExpect(status().isOk());

        responder("finalizar", solicitudId, conductor, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("CONFIRMACION_PENDIENTE"));
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado(),
                "sin confirmación, la unidad sigue en misión");

        confirmar(solicitudId, tokenCiudadano()).andExpect(status().isOk());

        responder("finalizar", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("TOMADA"))
                .andExpect(jsonPath("$.llegadaEn").isNotEmpty());
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado());
    }
}
