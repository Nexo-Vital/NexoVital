package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Case T8 of design §7: application restart. Seeding must be idempotent and
 * must not duplicate users.
 *
 * <p>The same {@link DataSeeder} is run over and over on the same already-seeded
 * context: each run must insert 0 users. It is the same path as a restart,
 * without booting a second context.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class DataSeederIdempotenciaTest extends LoginTestBase {

    /** Catalog D2: 11 users covering the 5 roles, with two citizens. */
    private static final int TAMANO_CATALOGO = 11;

    private static final List<String> EMAILS_DEL_CATALOGO = List.of(
            "rangel@nexovital.co",
            "admin@nexovital.co",
            "centro@nexovital.co",
            "acopio@nexovital.co",
            "ciudadano@nexovital.co",
            "ciudadano2@nexovital.co",
            "conductor1@nexovital.co",
            "conductor2@nexovital.co",
            "conductor3@nexovital.co",
            "conductor4@nexovital.co",
            "conductor5@nexovital.co");

    @Autowired
    private DataSeeder dataSeeder;

    @Test
    @DisplayName("T8 - re-running the seeder does not duplicate users: the count stays at 11")
    void t8_elSeederEsIdempotente() {
        assertEquals(TAMANO_CATALOGO, usuarioJpaRepository.count(),
                "startup must seed exactly the 11 users of the catalog (D2)");

        assertDoesNotThrow(() -> dataSeeder.run(), "re-running the seeder must not fail");
        assertEquals(TAMANO_CATALOGO, usuarioJpaRepository.count(),
                "the second seeder run must insert 0 users");

        assertDoesNotThrow(() -> dataSeeder.run(), "a third seeder run must not fail");
        assertEquals(TAMANO_CATALOGO, usuarioJpaRepository.count(),
                "the third seeder run must still insert 0 users");

        EMAILS_DEL_CATALOGO.forEach(email -> assertTrue(usuarioJpaRepository.existsByEmail(email),
                "the catalog must keep the account " + email));
    }
}
