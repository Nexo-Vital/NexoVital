package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.ConexionPushListener.ConexionPushPayload;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.FlotaPushPayload;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-04.F2.US1 — who receives a request, and the commands of the driver's own
 * unit (design scenarios S1 to S9, S15 and S16, plus the driver-console
 * adjustments: declared availability and the notice to the units that lost).
 *
 * <p>The rule under test: a request reaches ONLY the units that are available,
 * connected and with signal at the instant it is created.
 *
 * <p>S5 (a request without a pickup point answers 400) is already covered by
 * {@code SolicitudFlujoHttpTest.sinUbicacionDevuelve400}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudCandidatasHttpTest extends SolicitudHttpTestSupport {

    // -----------------------------------------------------------------------
    // S1 to S4 — who is notified
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S1: la solicitud llega a TODAS las unidades disponibles, conectadas y con señal")
    void s1_todasLasCandidatasRecibenLaSolicitud() throws Exception {
        List<Conductor> conductores = List.of(
                sembrarConductor(EstadoAmbulancia.DISPONIBLE),
                sembrarConductor(EstadoAmbulancia.DISPONIBLE),
                sembrarConductor(EstadoAmbulancia.DISPONIBLE),
                sembrarConductor(EstadoAmbulancia.DISPONIBLE));
        // The expected set is read from the database with the same three
        // conditions, right before the request: it includes the seeded units.
        Set<UUID> candidatas = ambulanciaJpaRepository
                .findByEstadoAndConectadaTrueAndSinSenalFalse(EstadoAmbulancia.DISPONIBLE).stream()
                .map(AmbulanciaJpaEntity::getId)
                .collect(Collectors.toSet());

        JsonNode creada = crearSolicitud(tokenCiudadano());

        assertEquals("PENDIENTE", creada.get("estado").asText());
        assertEquals(candidatas, notificadasDe(creada),
                "la solicitud notifica exactamente a las unidades candidatas");
        for (Conductor conductor : conductores) {
            assertTrue(notificadasDe(creada).contains(conductor.unidad()),
                    "cada unidad candidata de la prueba queda entre las notificadas");
            assertTrue(recibioSolicitudNueva(conductor, idDe(creada)),
                    "cada conductor candidato recibe el aviso en su propio destino");
        }
    }

    @Test
    @DisplayName("S2: una unidad en misión no está entre las notificadas ni recibe aviso")
    void s2_laUnidadOcupadaNoRecibeLaSolicitud() throws Exception {
        List<Conductor> libres = List.of(
                sembrarConductor(EstadoAmbulancia.DISPONIBLE),
                sembrarConductor(EstadoAmbulancia.DISPONIBLE),
                sembrarConductor(EstadoAmbulancia.DISPONIBLE));
        Conductor ocupado = sembrarConductor(EstadoAmbulancia.EN_MISION);

        JsonNode creada = crearSolicitud(tokenCiudadano());

        for (Conductor libre : libres) {
            assertTrue(notificadasDe(creada).contains(libre.unidad()));
            assertTrue(recibioSolicitudNueva(libre, idDe(creada)));
        }
        assertFalse(notificadasDe(creada).contains(ocupado.unidad()),
                "una unidad ocupada no entra en la lista de notificadas");
        assertFalse(recibioSolicitudNueva(ocupado, idDe(creada)),
                "una unidad ocupada no recibe el aviso de una solicitud nueva");
    }

    @Test
    @DisplayName("S3: en ruta, fuera de servicio, desconectada o sin señal no reciben; solo la candidata")
    void s3_soloLaCandidataRecibeLaSolicitud() throws Exception {
        Conductor candidata = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor enRuta = sembrarConductor(EstadoAmbulancia.EN_RUTA);
        Conductor fueraDeServicio = sembrarConductor(EstadoAmbulancia.MANTENIMIENTO);
        Conductor desconectada = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        desconectarEnBase(desconectada.unidad());
        Conductor sinSenal = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        dejarSinSenalEnBase(sinSenal.unidad());

        JsonNode creada = crearSolicitud(tokenCiudadano());

        assertTrue(notificadasDe(creada).contains(candidata.unidad()));
        assertTrue(recibioSolicitudNueva(candidata, idDe(creada)));
        for (Conductor excluido : List.of(enRuta, fueraDeServicio, desconectada, sinSenal)) {
            assertFalse(notificadasDe(creada).contains(excluido.unidad()),
                    "una unidad que no es candidata no entra en la lista: " + excluido.email());
            assertFalse(recibioSolicitudNueva(excluido, idDe(creada)),
                    "una unidad que no es candidata no recibe el aviso: " + excluido.email());
        }
    }

    @Test
    @DisplayName("S4: sin ninguna unidad candidata responde 409 AMBULANCIA_NO_DISPONIBLE y no guarda nada")
    void s4_sinCandidatasResponde409() throws Exception {
        String ciudadano = tokenCiudadano();
        // The database is shared: every connected unit is disconnected for this
        // test and connected again afterwards, whatever happens.
        List<UUID> conectadas = ambulanciaJpaRepository.findAll().stream()
                .filter(AmbulanciaJpaEntity::isConectada)
                .map(AmbulanciaJpaEntity::getId)
                .toList();
        jdbcTemplate.update("UPDATE ambulancias SET conectada = false");
        try {
            long solicitudesAntes = solicitudJpaRepository.count();

            solicitar(ciudadano)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.codigo").value("AMBULANCIA_NO_DISPONIBLE"));

            assertEquals(solicitudesAntes, solicitudJpaRepository.count(),
                    "sin candidatas no se guarda ninguna solicitud");
        } finally {
            for (UUID unidad : conectadas) {
                jdbcTemplate.update("UPDATE ambulancias SET conectada = true WHERE id = '" + unidad + "'");
            }
        }
    }

    // -----------------------------------------------------------------------
    // S6 to S9 — connect and disconnect the driver's own unit
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S6: desconectar y conectar la unidad propia cambia `conectada`, sube la versión y avisa por /topic/flota")
    void s6_desconectarYConectarLaUnidadPropia() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        long versionInicial = unidadEnBase(conductor.unidad()).getVersion();

        comandoDeMiUnidad("desconectar", token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(conductor.unidad().toString()))
                .andExpect(jsonPath("$.conectada").value(false));

        AmbulanciaJpaEntity desconectada = unidadEnBase(conductor.unidad());
        assertFalse(desconectada.isConectada());
        assertTrue(desconectada.getVersion() > versionInicial, "desconectar sube la versión de la unidad");
        ConexionPushPayload alDesconectar = ultimoFrameDeConexion();
        assertEquals(conductor.unidad(), alDesconectar.ambulanciaId());
        assertFalse(alDesconectar.conectada());
        assertEquals(desconectada.getVersion(), alDesconectar.version(),
                "el frame lleva la versión que dejó el cambio");

        pushPortDePrueba.limpiar();
        comandoDeMiUnidad("conectar", token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conectada").value(true));

        AmbulanciaJpaEntity conectada = unidadEnBase(conductor.unidad());
        assertTrue(conectada.isConectada());
        assertTrue(conectada.getVersion() > desconectada.getVersion(), "conectar sube la versión de la unidad");
        ConexionPushPayload alConectar = ultimoFrameDeConexion();
        assertEquals(conductor.unidad(), alConectar.ambulanciaId());
        assertTrue(alConectar.conectada());
    }

    @Test
    @DisplayName("S7: repetir \"conectar\" estando conectada responde 200 sin subir la versión ni emitir frame")
    void s7_conectarEstandoConectadaNoCambiaNada() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        long versionInicial = unidadEnBase(conductor.unidad()).getVersion();
        pushPortDePrueba.limpiar();

        comandoDeMiUnidad("conectar", token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conectada").value(true));

        assertEquals(versionInicial, unidadEnBase(conductor.unidad()).getVersion(),
                "un comando repetido no escribe nada");
        assertNull(pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA),
                "un comando repetido no emite ningún frame");
    }

    @Test
    @DisplayName("S8: no se puede desconectar con una solicitud aceptada (409 SOLICITUD_EN_CURSO)")
    void s8_noSePuedeDesconectarConUnaSolicitudAceptada() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        responder("accept", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true));

        comandoDeMiUnidad("desconectar", token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_EN_CURSO"));

        AmbulanciaJpaEntity unidad = unidadEnBase(conductor.unidad());
        assertTrue(unidad.isConectada(), "la unidad sigue conectada");
        assertEquals(EstadoAmbulancia.EN_MISION, unidad.getEstado(), "la unidad sigue en misión");
    }

    @Test
    @DisplayName("S9: un usuario que no es conductor no puede conectar ni desconectar (403)")
    void s9_soloUnConductorPuedeConectarYDesconectar() throws Exception {
        String ciudadano = tokenCiudadano();

        comandoDeMiUnidad("conectar", ciudadano).andExpect(status().isForbidden());
        comandoDeMiUnidad("desconectar", ciudadano).andExpect(status().isForbidden());
    }

    // -----------------------------------------------------------------------
    // S15 and S16 — a notified unit that disconnects
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("S15: una unidad notificada que se desconecta no puede aceptar; la solicitud sigue PENDIENTE")
    void s15_unaUnidadDesconectadaNoPuedeAceptar() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        JsonNode creada = crearSolicitud(tokenCiudadano());
        assertTrue(notificadasDe(creada).contains(conductor.unidad()));
        comandoDeMiUnidad("desconectar", token).andExpect(status().isOk());

        responder("accept", idDe(creada), conductor, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("AMBULANCIA_NO_DISPONIBLE"));

        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(idDe(creada)).orElseThrow().getEstado(),
                "la solicitud sigue abierta para las demás unidades");
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado(),
                "la unidad no quedó ocupada");
    }

    @Test
    @DisplayName("S16: las pendientes se ven conectada, no desconectada, de nuevo al reconectar, y nunca tras vencer")
    void s16_pendientesSegunLaConexionYElVencimiento() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        assertTrue(pendientesDe(token).contains(solicitudId),
                "conectada y notificada: la solicitud aparece");

        comandoDeMiUnidad("desconectar", token).andExpect(status().isOk());
        assertTrue(pendientesDe(token).isEmpty(), "desconectada: no ve ninguna solicitud");

        comandoDeMiUnidad("conectar", token).andExpect(status().isOk());
        assertTrue(pendientesDe(token).contains(solicitudId),
                "si se reconecta antes de que venza, la solicitud vuelve a aparecer");

        // The window is measured with the injected clock: once it has passed,
        // the request is no longer offered, even before the sweep closes it.
        clock.avanzar(Duration.ofDays(1));
        assertFalse(pendientesDe(token).contains(solicitudId), "vencida: ya no aparece");
    }

    @Test
    @DisplayName("S16: una unidad que no fue notificada no ve la solicitud entre sus pendientes")
    void s16_unaUnidadNoNotificadaNoVeLaSolicitud() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        // Created after the request and without any command: nothing notified it.
        Conductor ajeno = sembrarConductor(EstadoAmbulancia.DISPONIBLE);

        assertFalse(pendientesDe(tokenDe(ajeno)).contains(solicitudId));
    }

    // -----------------------------------------------------------------------
    // Declared availability ("Disponible" / "Fuera de servicio")
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Fuera de servicio: la unidad deja de recibir solicitudes; al volver a Disponible las recibe de nuevo")
    void fueraDeServicioDejaDeRecibirSolicitudes() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        String ciudadano = tokenCiudadano();

        declararDisponibilidad(false, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("MANTENIMIENTO"));
        assertEquals(EstadoAmbulancia.MANTENIMIENTO, unidadEnBase(conductor.unidad()).getEstado());
        PublicacionCapturada flota = pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA);
        assertNotNull(flota, "el cambio de estado se propaga por /topic/flota");
        assertInstanceOf(FlotaPushPayload.class, flota.payload());
        assertEquals(conductor.unidad(), ((FlotaPushPayload) flota.payload()).ambulanciaId());
        assertEquals("MANTENIMIENTO", ((FlotaPushPayload) flota.payload()).estado());

        JsonNode fuera = crearSolicitud(ciudadano);
        assertFalse(notificadasDe(fuera).contains(conductor.unidad()),
                "fuera de servicio no recibe solicitudes nuevas");

        declararDisponibilidad(true, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("DISPONIBLE"));
        JsonNode dentro = crearSolicitud(ciudadano);
        assertTrue(notificadasDe(dentro).contains(conductor.unidad()),
                "de vuelta en Disponible recibe solicitudes nuevas");
    }

    @Test
    @DisplayName("Con un servicio en curso no se puede cambiar el estado a mano (409 SOLICITUD_EN_CURSO)")
    void noSePuedeDeclararDisponibilidadEnMision() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        responder("accept", solicitudId, conductor, token).andExpect(status().isOk());

        declararDisponibilidad(false, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_EN_CURSO"));
        declararDisponibilidad(true, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_EN_CURSO"));

        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado(),
                "el estado de una unidad en misión lo decide la misión");
    }

    @Test
    @DisplayName("Disponibilidad sin el campo `disponible` responde 400; con otro rol, 403")
    void disponibilidadValidaElCuerpoYElRol() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);

        mockMvc.perform(post("/api/v1/flota/ambulancias/mia/disponibilidad")
                        .header("Authorization", "Bearer " + tokenDe(conductor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado());

        declararDisponibilidad(false, tokenCiudadano()).andExpect(status().isForbidden());
    }

    // -----------------------------------------------------------------------
    // The units that did not win are told at once
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Al aceptar una unidad, las demás notificadas reciben ASIGNADA con la ganadora; la ganadora, un solo frame")
    void lasDemasUnidadesSabenQueLaSolicitudFueTomada() throws Exception {
        Conductor ganador = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor otro = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenGanador = tokenDe(ganador);
        String tokenOtro = tokenDe(otro);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("accept", solicitudId, ganador, tokenGanador)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true));

        List<SolicitudPushPayload> alOtro = framesDe(otro, solicitudId, "ASIGNADA");
        assertEquals(1, alOtro.size(), "la unidad que no ganó recibe un aviso, y solo uno");
        assertEquals(ganador.unidad(), alOtro.get(0).ambulanciaAsignadaId(),
                "el aviso dice qué unidad tiene la solicitud");
        assertEquals(1, framesDe(ganador, solicitudId, "ASIGNADA").size(),
                "la ganadora recibe su propio aviso una sola vez");

        // Too late for the other unit: the server answers the conflict the
        // console turns into "ya fue aceptada por otra ambulancia".
        responder("accept", solicitudId, otro, tokenOtro)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(otro.unidad()).getEstado(),
                "la unidad que perdió no queda ocupada");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** The last frame on {@code /topic/flota}, which must be a connection frame. */
    private ConexionPushPayload ultimoFrameDeConexion() {
        PublicacionCapturada flota = pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA);
        assertNotNull(flota, "el cambio de conexión se propaga por /topic/flota");
        assertInstanceOf(ConexionPushPayload.class, flota.payload());
        return (ConexionPushPayload) flota.payload();
    }
}
