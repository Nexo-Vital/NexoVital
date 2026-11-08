package co.edu.escuelaing.nexovital.observabilidad;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import co.edu.escuelaing.nexovital.recursos.application.usecase.InventarioPushListener;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sprint 2, T43: the business indicator must match what the database holds. A
 * donation writes one critical-action row and propagates one realtime event, so
 * the counter for {@code /topic/suministros} and the persisted
 * {@code INSUMO_DONADO} row must move together.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class})
class MetricasNegocioTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String METRICA_EVENTOS = "nexovital.eventos.realtime";
    private static final String PREFIJO_PRUEBA = "Metrica T43 ";

    @Autowired
    private MeterRegistry registro;

    @Autowired
    private RegistroAuditoriaPort registroAuditoriaPort;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    private UUID centroId;
    private UUID itemId;

    @BeforeEach
    void sembrarItem() {
        centroId = listarOrganizacionesUseCase.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .filter(organizacion -> organizacion.getNombre().equals("Acopio Suba Norte"))
                .map(Organizacion::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("no se encontró el centro sembrado"));
        itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId, centroId, PREFIJO_PRUEBA + itemId, 10, 100, "unidades", null));
    }

    @AfterEach
    void limpiar() {
        List<ItemInventarioJpaEntity> aBorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(aBorrar);
    }

    @Test
    @DisplayName("T43: el contador de eventos coincide con la fila persistida de la donación")
    void elContadorCoincideConLaBaseDeDatos() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        double antes = contadorDe(InventarioPushListener.DESTINO_SUMINISTROS);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 25))))
                .andExpect(status().isOk());

        double despues = contadorDe(InventarioPushListener.DESTINO_SUMINISTROS);
        long filasPersistidas = registroAuditoriaPort
                .porRecurso(EventoAuditoria.TIPO_CENTRO, centroId).stream()
                .filter(evento -> evento.accion() == AccionCritica.INSUMO_DONADO)
                .filter(evento -> evento.detalle() != null && evento.detalle().contains(itemId.toString()))
                .count();

        assertEquals(1, filasPersistidas, "la donación debe dejar una fila en la bitácora");
        assertEquals(filasPersistidas, despues - antes,
                "el indicador de eventos debe coincidir con lo persistido en la base");
    }

    private double contadorDe(String destino) {
        Counter contador = registro.find(METRICA_EVENTOS).tag("destino", destino).counter();
        return contador == null ? 0d : contador.count();
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
