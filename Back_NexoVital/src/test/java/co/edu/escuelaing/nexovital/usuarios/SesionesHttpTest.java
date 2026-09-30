package co.edu.escuelaing.nexovital.usuarios;

import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Cases T1, T2, T3, T4, T5 and T7 of design §7, at the real HTTP level of
 * {@code POST /api/v1/sesiones} and {@code GET /api/v1/sesiones/actual}.
 *
 * <p>The real status code, body and {@code Retry-After} header are asserted.
 * The clock is controlled with {@link TestClockConfig} (D8) for the 5-minute
 * window cases (T3) without sleeping the suite.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class SesionesHttpTest extends LoginTestBase {

    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";
    private static final String PASSWORD_INCORRECTA = "contrasena-incorrecta";

    private static final long VENTANA_SEGUNDOS = 300L;

    // -----------------------------------------------------------------------
    // T1
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T1 - 3 wrong passwords: 401, 401 and 423 with CUENTA_BLOQUEADA and Retry-After")
    void t1_tresFallosSeguidos_bloqueanEnElTerceroConRetryAfter() throws Exception {
        intentarLogin(RANGEL, PASSWORD_INCORRECTA)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("CREDENCIALES_INVALIDAS"));

        intentarLogin(RANGEL, PASSWORD_INCORRECTA)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("CREDENCIALES_INVALIDAS"));

        MvcResult tercero = intentarLogin(RANGEL, PASSWORD_INCORRECTA)
                .andExpect(status().is(423))
                .andExpect(jsonPath("$.codigo").value("CUENTA_BLOQUEADA"))
                .andExpect(header().exists("Retry-After"))
                .andReturn();

        long retryAfter = Long.parseLong(tercero.getResponse().getHeader("Retry-After"));
        assertTrue(retryAfter > 0 && retryAfter <= VENTANA_SEGUNDOS,
                "Retry-After must be in (0, " + VENTANA_SEGUNDOS + "] seconds, observed: " + retryAfter);

        assertEquals(3, intentosDe(RANGEL), "the counter must reach 3 after the third failure");
        assertNotNull(bloqueadoHastaDe(RANGEL), "the block must be set after the third failure");
    }

    // -----------------------------------------------------------------------
    // T2
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T2 - while blocked, the correct password returns 423 without issuing a token or incrementing")
    void t2_estandoBloqueado_laContrasenaCorrectaNoSeEvalua() throws Exception {
        bloquearCuenta(RANGEL);

        // One minute is advanced: the window is still valid and, if the attempt
        // extended the block or counted, this test would detect it.
        clock.avanzar(Duration.ofSeconds(60));
        Instant bloqueoAntesDelIntento = bloqueadoHastaDe(RANGEL);

        intentarLogin(RANGEL, RANGEL_PASSWORD)
                .andExpect(status().is(423))
                .andExpect(jsonPath("$.codigo").value("CUENTA_BLOQUEADA"))
                .andExpect(jsonPath("$.token").doesNotExist());

        assertEquals(3, intentosDe(RANGEL),
                "while blocked, the attempt must not increment intentos_fallidos");
        assertEquals(bloqueoAntesDelIntento, bloqueadoHastaDe(RANGEL),
                "the lockout window must not be extended by retrying (D5)");
    }

    // -----------------------------------------------------------------------
    // T3
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T3 - expired window (5 min + 1 s): 200 + token and intentos_fallidos = 0")
    void t3_ventanaExpirada_permiteLoginYReiniciaElContador() throws Exception {
        bloquearCuenta(RANGEL);
        assertEquals(3, intentosDe(RANGEL), "the starting scenario is a blocked account");

        clock.avanzar(Duration.ofMinutes(5).plusSeconds(1));

        MvcResult resultado = intentarLogin(RANGEL, RANGEL_PASSWORD)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andReturn();

        assertFalse(resultado.getResponse().getContentAsString().isBlank());
        assertEquals(0, intentosDe(RANGEL), "a successful login must leave intentos_fallidos = 0");
        assertNull(bloqueadoHastaDe(RANGEL), "a successful login must leave bloqueado_hasta = NULL");
    }

    // -----------------------------------------------------------------------
    // T4
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T4 - 2 failures, 1 success, 3 failures: the success resets and the block fires on the third after it")
    void t4_elExitoReiniciaElContador_yElBloqueoDisparaEnElTerceroPosterior() throws Exception {
        intentarLogin(RANGEL, PASSWORD_INCORRECTA).andExpect(status().isUnauthorized());
        intentarLogin(RANGEL, PASSWORD_INCORRECTA).andExpect(status().isUnauthorized());
        assertEquals(2, intentosDe(RANGEL));

        intentarLogin(RANGEL, RANGEL_PASSWORD).andExpect(status().isOk());
        assertEquals(0, intentosDe(RANGEL), "the successful login must reset the counter");

        intentarLogin(RANGEL, PASSWORD_INCORRECTA).andExpect(status().isUnauthorized());
        assertEquals(1, intentosDe(RANGEL));

        intentarLogin(RANGEL, PASSWORD_INCORRECTA).andExpect(status().isUnauthorized());
        assertEquals(2, intentosDe(RANGEL), "the block must not fire before the third failure");

        intentarLogin(RANGEL, PASSWORD_INCORRECTA).andExpect(status().is(423));
        assertEquals(3, intentosDe(RANGEL), "the block must fire on exactly the third failure after the success");
    }

    // -----------------------------------------------------------------------
    // T5
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T5 - non-existent email: always 401, never 423, and no attempt state is created")
    void t5_emailInexistente_siempreEs401YNoCreaEstado() throws Exception {
        String inexistente = "no-existe@nexovital.co";
        long usuariosAntes = usuarioJpaRepository.count();

        for (int intento = 1; intento <= 3; intento++) {
            intentarLogin(inexistente, "cualquier-contrasena")
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.codigo").value("CREDENCIALES_INVALIDAS"));
        }

        assertTrue(usuarioJpaRepository.findByEmail(inexistente).isEmpty(),
                "a non-existent email must not create a user row");
        assertEquals(usuariosAntes, usuarioJpaRepository.count(),
                "a non-existent email must not create or modify attempt state");
    }

    // -----------------------------------------------------------------------
    // T7
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T7 - the 5 preloaded roles log in and /sesiones/actual returns their role")
    void t7_losCincoRolesInicianSesion_ySesionActualDevuelveSuRol() throws Exception {
        record CredencialDemo(String email, String password, RolUsuario rol) {
        }

        List<CredencialDemo> catalogoDeRoles = List.of(
                new CredencialDemo(RANGEL, RANGEL_PASSWORD, RolUsuario.ADMIN_CENTRO_AYUDA),
                new CredencialDemo("admin@nexovital.co", "admin123", RolUsuario.ADMIN_PLATAFORMA),
                new CredencialDemo("acopio@nexovital.co", "acopio123", RolUsuario.ADMIN_ACOPIO),
                new CredencialDemo("ciudadano@nexovital.co", "ciudadano123", RolUsuario.CIUDADANO),
                new CredencialDemo("conductor1@nexovital.co", "conductor123", RolUsuario.CONDUCTOR));

        for (CredencialDemo credencial : catalogoDeRoles) {
            MvcResult login = intentarLogin(credencial.email(), credencial.password())
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.usuario.email").value(credencial.email()))
                    .andExpect(jsonPath("$.usuario.rol").value(credencial.rol().name()))
                    .andReturn();

            String token = objectMapper.readTree(login.getResponse().getContentAsString())
                    .get("token").asText();
            assertFalse(token.isBlank(), "the login of " + credencial.email() + " must issue a token");

            mockMvc.perform(get("/api/v1/sesiones/actual")
                            .header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.email").value(credencial.email()))
                    .andExpect(jsonPath("$.rol").value(credencial.rol().name()));
        }
    }
}
