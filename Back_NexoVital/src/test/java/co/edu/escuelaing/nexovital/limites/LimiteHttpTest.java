package co.edu.escuelaing.nexovital.limites;

import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Casos HTTP del límite de solicitudes (Limit Access / Detect Service Denial).
 *
 * <p>El límite por usuario se baja a 2 para no tener que disparar diez
 * peticiones. El cuerpo va vacío a propósito: el interceptor corre ANTES de
 * resolver el {@code @RequestBody}, así que cada intento cuenta aunque el cuerpo
 * sea inválido. Es el comportamiento correcto — si un cuerpo mal formado no
 * contara, alcanzaría con mandar basura para saltarse el límite.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = {
        "nexovital.limites.usuario-por-minuto=2",
        "nexovital.limites.ip-por-minuto=100000"
})
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class LimiteHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String CIUDADANO_2 = "ciudadano2@nexovital.co";

    @BeforeEach
    void limpiarContadores() {
        // El reloj está congelado, así que la ventana no avanza entre tests:
        // sin esto, el contador del primer test ensuciaría el segundo.
        jdbcTemplate.update("DELETE FROM limite_solicitudes");
    }

    @Test
    @DisplayName("Al pasar el límite por usuario la respuesta es 429 con Retry-After")
    void pasadoElLimiteResponde429() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        // Las dos primeras cuentan y siguen de largo (el cuerpo vacío da 400).
        reportar(token).andExpect(status().isBadRequest());
        reportar(token).andExpect(status().isBadRequest());

        // La tercera ya no llega al controlador.
        reportar(token)
                .andExpect(status().is(429))
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(jsonPath("$.codigo").value("DEMASIADAS_SOLICITUDES"));
    }

    @Test
    @DisplayName("Agotar el cupo de un usuario no bloquea a otro")
    void elLimiteEsPorUsuario() throws Exception {
        String tokenUno = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        reportar(tokenUno).andExpect(status().isBadRequest());
        reportar(tokenUno).andExpect(status().isBadRequest());
        reportar(tokenUno).andExpect(status().is(429));

        String tokenDos = tokenDe(CIUDADANO_2, CIUDADANO_PASSWORD);
        reportar(tokenDos).andExpect(status().isBadRequest());
    }

    private org.springframework.test.web.servlet.ResultActions reportar(String token) throws Exception {
        return mockMvc.perform(post("/api/v1/emergencias")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"));
    }

    /** Abre una sesión real y devuelve el Bearer. */
    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
