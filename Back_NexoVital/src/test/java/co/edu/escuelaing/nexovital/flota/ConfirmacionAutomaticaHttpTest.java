package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarLlegadasVencidasUseCase;
import co.edu.escuelaing.nexovital.support.MutableClock;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Finishing needs the citizen's confirmation, which arrives by itself after 60 s. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class ConfirmacionAutomaticaHttpTest extends SolicitudHttpTestSupport {

    @Autowired
    private ConfirmarLlegadasVencidasUseCase confirmarLlegadasVencidasUseCase;

    @Autowired
    private MutableClock clock;

    @AfterEach
    void restaurarReloj() {
        clock.fijar(TestClockConfig.INSTANTE_BASE);
    }

    private EstadoSolicitud estadoEnBase(UUID solicitudId) {
        return solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado();
    }

    private Instant llegadaEnBase(UUID solicitudId) {
        return solicitudJpaRepository.findById(solicitudId).orElseThrow().getLlegadaEn();
    }

    /** CONFIRMADA frames the citizen received for the request. */
    private long confirmacionesAlCiudadano(UUID solicitudId) {
        String ciudadanoId = usuarioDe(CIUDADANO).getId().toString();
        return pushPortDePrueba.haciaUsuario(ciudadanoId, FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .map(PublicacionCapturada::payload)
                .filter(payload -> payload instanceof SolicitudPushPayload solicitud
                        && solicitudId.equals(solicitud.solicitudId())
                        && "CONFIRMADA".equals(solicitud.estado()))
                .count();
    }

    @Test
    @DisplayName("C1: sin respuesta del ciudadano, la llegada se confirma sola al cumplir el plazo")
    void c1_confirmacionAutomaticaHabilitaFinalizar() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        responder("accept", solicitudId, conductor, token).andExpect(status().isOk());
        responder("llegada", solicitudId, conductor, token).andExpect(status().isOk());
        Instant llegada = llegadaEnBase(solicitudId);
        pushPortDePrueba.limpiar();

        clock.fijar(llegada.plusSeconds(59));
        confirmarLlegadasVencidasUseCase.confirmarVencidas();
        assertEquals(EstadoSolicitud.ASIGNADA, estadoEnBase(solicitudId), "antes del plazo no se confirma");
        responder("finalizar", solicitudId, conductor, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("CONFIRMACION_PENDIENTE"));

        clock.fijar(llegada.plusSeconds(61));
        confirmarLlegadasVencidasUseCase.confirmarVencidas();
        assertEquals(EstadoSolicitud.CONFIRMADA, estadoEnBase(solicitudId));
        assertEquals(1, framesDe(conductor, solicitudId, "CONFIRMADA").size(), "el conductor recibe la confirmación");
        assertEquals(1, confirmacionesAlCiudadano(solicitudId), "el ciudadano también");

        confirmarLlegadasVencidasUseCase.confirmarVencidas();
        assertEquals(1, confirmacionesAlCiudadano(solicitudId), "un segundo barrido no repite el aviso");

        responder("finalizar", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("TOMADA"));
    }

    @Test
    @DisplayName("C2: si el ciudadano confirma después de la confirmación automática, responde 200 sin repetir avisos")
    void c2_confirmarTrasLaAutomaticaEsIdempotente() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));
        responder("accept", solicitudId, conductor, token).andExpect(status().isOk());
        responder("llegada", solicitudId, conductor, token).andExpect(status().isOk());
        clock.fijar(llegadaEnBase(solicitudId).plusSeconds(61));
        confirmarLlegadasVencidasUseCase.confirmarVencidas();
        pushPortDePrueba.limpiar();

        confirmarLlegada(solicitudId, ciudadano)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("CONFIRMADA"));
        assertEquals(0, confirmacionesAlCiudadano(solicitudId));
    }

    @Test
    @DisplayName("C3: sin llegada declarada, el barrido nunca confirma la solicitud")
    void c3_sinLlegadaNoSeConfirma() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        responder("accept", solicitudId, conductor, token).andExpect(status().isOk());

        clock.fijar(Instant.now().plusSeconds(3600));
        confirmarLlegadasVencidasUseCase.confirmarVencidas();
        assertEquals(EstadoSolicitud.ASIGNADA, estadoEnBase(solicitudId));
    }
}
