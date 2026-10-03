package co.edu.escuelaing.nexovital.usuarios;

import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.JwtTokenAdapter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.time.Clock;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Startup rules of the JWT secret: optional in development (a random one is
 * generated per run), mandatory with the {@code prod} profile, and never
 * accepted when it is defined but too short.
 */
class JwtSecretoArranqueTest {

    private static final long UNA_HORA = 3_600_000L;

    @Test
    @DisplayName("Desarrollo sin secreto: arranca con uno aleatorio y emite tokens validos")
    void desarrolloSinSecretoGeneraUnoAleatorio() {
        JwtTokenAdapter adapter = new JwtTokenAdapter("", UNA_HORA, Clock.systemUTC(), new MockEnvironment());

        UUID usuario = UUID.randomUUID();
        String token = adapter.generar(usuario);

        assertTrue(adapter.validar(token));
        assertEquals(usuario, adapter.extraerSubject(token));
    }

    @Test
    @DisplayName("Desarrollo sin secreto: cada arranque usa un secreto distinto")
    void cadaArranqueUsaUnSecretoDistinto() {
        JwtTokenAdapter primero = new JwtTokenAdapter("", UNA_HORA, Clock.systemUTC(), new MockEnvironment());
        JwtTokenAdapter segundo = new JwtTokenAdapter("", UNA_HORA, Clock.systemUTC(), new MockEnvironment());

        String token = primero.generar(UUID.randomUUID());

        assertFalse(segundo.validar(token),
                "un token firmado en otro arranque no debe validar: el secreto no es fijo");
    }

    @Test
    @DisplayName("Perfil prod sin secreto: el arranque aborta")
    void prodSinSecretoAborta() {
        MockEnvironment prod = new MockEnvironment();
        prod.setActiveProfiles("prod");

        assertThrows(IllegalStateException.class,
                () -> new JwtTokenAdapter("", UNA_HORA, Clock.systemUTC(), prod));
    }

    @Test
    @DisplayName("Secreto definido pero corto: aborta tambien en desarrollo")
    void secretoCortoAbortaEnCualquierPerfil() {
        assertThrows(IllegalStateException.class,
                () -> new JwtTokenAdapter("corto", UNA_HORA, Clock.systemUTC(), new MockEnvironment()));
    }
}
