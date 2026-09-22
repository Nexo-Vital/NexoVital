package co.edu.escuelaing.nexovital.support;

import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.UsuarioJpaEntity;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.UsuarioJpaRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Base of the login tests: shared infrastructure, without context annotations
 * (each test class declares its own so Spring Boot's TestContext is reused
 * across all of them).
 *
 * <p>Every test starts with the clock at {@link TestClockConfig#INSTANTE_BASE}
 * and with all attempt state reset to zero, so execution order does not
 * contaminate results.
 */
public abstract class LoginTestBase {

    /** Zeroed attempt state for the whole table, before each test. */
    private static final String REINICIAR_ESTADO_INTENTOS =
            "UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL";

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    @Autowired
    protected MutableClock clock;

    @Autowired
    protected UsuarioJpaRepository usuarioJpaRepository;

    @Autowired
    protected JdbcTemplate jdbcTemplate;

    @BeforeEach
    void reiniciarRelojYEstadoDeIntentos() {
        clock.fijar(TestClockConfig.INSTANTE_BASE);
        jdbcTemplate.update(REINICIAR_ESTADO_INTENTOS);
    }

    /** Executes {@code POST /api/v1/sesiones} with the given credentials. */
    protected ResultActions intentarLogin(String email, String password) throws Exception {
        String cuerpo = objectMapper.writeValueAsString(Map.of("email", email, "password", password));
        return mockMvc.perform(post("/api/v1/sesiones")
                .contentType(MediaType.APPLICATION_JSON)
                .content(cuerpo));
    }

    /**
     * Leaves the account blocked by its third consecutive failure (D5).
     * Fails the test if the block does not fire on exactly the third attempt.
     */
    protected void bloquearCuenta(String email) throws Exception {
        intentarLogin(email, "contrasena-incorrecta").andExpect(status().isUnauthorized());
        intentarLogin(email, "contrasena-incorrecta").andExpect(status().isUnauthorized());
        intentarLogin(email, "contrasena-incorrecta").andExpect(status().is(423));
    }

    /** Persisted row for the account, read in a fresh JPA session. */
    protected UsuarioJpaEntity usuarioDe(String email) {
        UsuarioJpaEntity entidad = usuarioJpaRepository.findByEmail(email).orElse(null);
        assertNotNull(entidad, "the seeded account must exist: " + email);
        return entidad;
    }

    protected int intentosDe(String email) {
        return usuarioDe(email).getIntentosFallidos();
    }

    protected Instant bloqueadoHastaDe(String email) {
        return usuarioDe(email).getBloqueadoHasta();
    }
}
