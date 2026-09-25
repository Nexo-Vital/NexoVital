package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.infrastructure.config.DataSeeder;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Persistence-level cases of {@code recursos}: el crédito atómico del puerto
 * {@link InventarioRepository#acreditar} y la idempotencia del seed de
 * inventario. No van por HTTP porque no hay endpoint de escritura en esta
 * rebanada (la donación es SB-9).
 *
 * <p>El caso de crédito corre en una transacción de prueba que se revierte al
 * final, para no contaminar el inventario sembrado que otros tests leen.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class InventarioPersistenciaTest extends LoginTestBase {

    /** 4 items de Suba Norte + 3 de La Gaitana + 3 de Tibabuyes = 10. */
    private static final long ITEMS_SEMBRADOS = 10L;

    @Autowired
    private InventarioRepository inventarioRepository;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private DataSeeder dataSeeder;

    @Test
    @Transactional
    @DisplayName("acreditar credits an existing item and returns false for a missing one")
    void t1_acreditarCreditaYRechazaItemInexistente() {
        ItemInventario antes = inventarioRepository.listarTodos().get(0);
        int cantidad = 7;

        boolean acreditado = inventarioRepository.acreditar(antes.getCentroAcopioId(), antes.getId(), cantidad);
        assertTrue(acreditado, "the seeded item must be credited");

        ItemInventario despues = inventarioRepository
                .buscar(antes.getCentroAcopioId(), antes.getId())
                .orElseThrow(() -> new AssertionError("the credited item must still exist"));
        assertEquals(antes.getDisponible() + cantidad, despues.getDisponible(),
                "the credit must add exactly the requested quantity");

        boolean inexistente = inventarioRepository.acreditar(antes.getCentroAcopioId(), UUID.randomUUID(), cantidad);
        assertFalse(inexistente, "a missing item must not be credited");
    }

    @Test
    @DisplayName("Re-running the seeder does not duplicate inventory items")
    void t2_elSeedDeInventarioEsIdempotente() {
        assertEquals(ITEMS_SEMBRADOS, itemInventarioJpaRepository.count(),
                "startup must seed exactly the 10 catalog items");

        assertDoesNotThrow(() -> dataSeeder.run(), "re-running the seeder must not fail");
        assertEquals(ITEMS_SEMBRADOS, itemInventarioJpaRepository.count(),
                "the second seeder run must insert 0 inventory items");

        assertDoesNotThrow(() -> dataSeeder.run(), "a third seeder run must not fail");
        assertEquals(ITEMS_SEMBRADOS, itemInventarioJpaRepository.count(),
                "the third seeder run must still insert 0 inventory items");
    }
}
