package co.edu.escuelaing.nexovital.auditoria;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.EventoAuditoriaJpaEntity;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.EventoAuditoriaJpaRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Sprint 2, T16: the audit log must cover every critical action and must not be
 * rewritable. The coverage check is structural on purpose: it fails the day
 * somebody adds a new {@link AccionCritica} and forgets its emitter. The
 * per-action behavior is exercised by the HTTP suites of each module.
 */
@SpringBootTest
@ActiveProfiles("test")
class AuditoriaInmutabilidadTest {

    @Autowired
    private EventoAuditoriaJpaRepository repositorio;

    @Autowired
    private EntityManager entityManager;

    private final List<UUID> creados = new ArrayList<>();

    @AfterEach
    void limpiar() {
        repositorio.deleteAllById(creados);
        creados.clear();
    }

    @Test
    void unEventoGrabadoNoSePuedeModificar() throws Exception {
        UUID id = UUID.randomUUID();
        creados.add(id);
        repositorio.saveAndFlush(new EventoAuditoriaJpaEntity(
                id, null, "ADMIN_PLATAFORMA", AccionCritica.INSUMO_DONADO,
                "CENTRO_ACOPIO", UUID.randomUUID(), "original", Instant.now()));
        entityManager.clear();

        EventoAuditoriaJpaEntity cargado = repositorio.findById(id).orElseThrow();
        Field detalle = EventoAuditoriaJpaEntity.class.getDeclaredField("detalle");
        detalle.setAccessible(true);
        detalle.set(cargado, "alterado");

        repositorio.saveAndFlush(cargado);
        entityManager.clear();

        assertEquals("original", repositorio.findById(id).orElseThrow().getDetalle(),
                "una fila de auditoría no se reescribe: Hibernate ignora el cambio");
    }

    @Test
    void laEntidadNoExponeSetters() {
        for (Method metodo : EventoAuditoriaJpaEntity.class.getDeclaredMethods()) {
            assertFalse(metodo.getName().startsWith("set"),
                    "la bitácora no debe tener setters: " + metodo.getName());
        }
    }

    @Test
    void todaAccionCriticaTieneAlMenosUnEmisorEnElCodigoDeProduccion() throws Exception {
        Path fuentes = Path.of("src", "main", "java");
        assertTrue(Files.isDirectory(fuentes), "se esperaba el árbol de fuentes de producción");

        try (Stream<Path> archivos = Files.walk(fuentes)) {
            List<String> codigo = archivos
                    .filter(ruta -> ruta.toString().endsWith(".java"))
                    .filter(ruta -> !ruta.getFileName().toString().equals("AccionCritica.java"))
                    .map(AuditoriaInmutabilidadTest::leer)
                    .toList();

            for (AccionCritica accion : AccionCritica.values()) {
                assertTrue(codigo.stream().anyMatch(texto -> texto.contains(accion.name())),
                        "ninguna acción crítica queda sin emisor: " + accion);
            }
        }
    }

    private static String leer(Path ruta) {
        try {
            return Files.readString(ruta);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("no se pudo leer " + ruta, e);
        }
    }
}
