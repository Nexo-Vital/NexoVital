package co.edu.escuelaing.nexovital.usuarios;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * El login propio es un recurso de desarrollo, no del producto (ADR-0008).
 *
 * <p>Estos casos fijan el comportamiento con
 * {@code nexovital.auth.local.enabled=false}, que es el valor por defecto de
 * {@code application.properties} y el que llevan docker y prod: crear una
 * sesión responde <b>404</b>, no 401. Un 401 haría pensar que el endpoint existe
 * y que las credenciales podrían ser válidas en algún lado; un 404 dice la
 * verdad: el recurso no está. La lectura de la sesión vigente sigue existiendo y
 * sigue exigiendo token.
 *
 * <p>La suite corre con la propiedad en {@code true}
 * ({@code application-test.properties}); esta clase la apaga con
 * {@link TestPropertySource}, que tiene prioridad sobre el archivo.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "nexovital.auth.local.enabled=false")
class SesionLocalDeshabilitadoTest {

    private static final String CUERPO = """
            {"email":"conductor1@nexovital.co","password":"conductor123"}
            """;

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("Con el login propio apagado, crear sesion responde 404 y no emite token")
    void crearSesionConLoginApagadoDevuelve404() throws Exception {
        mockMvc.perform(post("/api/v1/sesiones")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(CUERPO))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("Con el login propio apagado, la sesion vigente sigue exigiendo token")
    void sesionActualSinTokenDevuelve401() throws Exception {
        mockMvc.perform(get("/api/v1/sesiones/actual"))
                .andExpect(status().isUnauthorized());
    }
}
