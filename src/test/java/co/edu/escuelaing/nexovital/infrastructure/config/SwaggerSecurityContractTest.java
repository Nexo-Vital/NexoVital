package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Fixes the security contract of the API documentation: the springdoc routes
 * are declared and reachable, while the chain stays fail-closed for everything
 * else.
 *
 * <p>It is the security counterpart of the live check: if someone removes the
 * declaration from {@link SecurityConfig}, the doc routes answer 403 and this
 * test fails; if someone relaxes {@code anyRequest().denyAll()}, the undeclared
 * route stops answering 403 and this test fails too.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SwaggerSecurityContractTest extends LoginTestBase {

    @Test
    @DisplayName("Las rutas de la documentacion estan declaradas: /v3/api-docs responde 200 sin token")
    void apiDocsEsPublico() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Las rutas de la documentacion estan declaradas: /swagger-ui/index.html responde 200 sin token")
    void swaggerUiEsPublico() throws Exception {
        mockMvc.perform(get("/swagger-ui/index.html"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Un endpoint protegido sigue sin relajarse: GET /api/v1/mapa sin token responde 401")
    void unProtegidoSigueSinToken() throws Exception {
        mockMvc.perform(get("/api/v1/mapa"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    @DisplayName("La cadena sigue fail-closed: una ruta no declarada responde 403 aun autenticado")
    void unaRutaNoDeclaradaResponde403() throws Exception {
        // POST /api/v1/usuarios does NOT exist in the backend: it is neither
        // implemented nor declared, so the denyAll catches it. The caller is
        // authenticated on purpose: an unauthenticated hit answers 401 (not
        // authenticated), while an authenticated one must answer 403
        // (authenticated but denied), which is what proves the chain is
        // fail-closed and not merely "closed to anonymous callers".
        String token = tokenDe("admin@nexovital.co", "admin123");

        mockMvc.perform(post("/api/v1/usuarios")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
