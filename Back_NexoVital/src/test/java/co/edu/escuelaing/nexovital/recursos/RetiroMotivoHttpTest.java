package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.RetiroInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.RetiroInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
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
import org.springframework.test.web.servlet.ResultActions;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Refinements, lote C: the reason of a withdrawal is stored with it. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class RetiroMotivoHttpTest extends LoginTestBase {

    private static final String ADMIN = "admin@nexovital.co";
    private static final String ADMIN_PASSWORD = "admin123";
    private static final String PREFIJO_PRUEBA = "Prueba RETIRO ";
    private static final int DISPONIBLE_INICIAL = 5;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private RetiroInventarioJpaRepository retiroInventarioJpaRepository;

    private UUID centroId;
    private UUID itemId;

    @BeforeEach
    void sembrarItem() {
        centroId = listarOrganizacionesUseCase.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .filter(organizacion -> organizacion.getNombre().equals("Acopio Suba Norte"))
                .map(Organizacion::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("seeded center not found"));
        itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId, centroId, PREFIJO_PRUEBA + itemId, DISPONIBLE_INICIAL, 1, null, null));
    }

    @AfterEach
    void limpiar() {
        retiroInventarioJpaRepository.deleteAll(retiroInventarioJpaRepository.findByItemIdOrderByRetiradoEnDesc(itemId));
        itemInventarioJpaRepository.deleteById(itemId);
    }

    private String tokenAdmin() throws Exception {
        MvcResult login = intentarLogin(ADMIN, ADMIN_PASSWORD).andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }

    private ResultActions retirar(String token, int cantidad, String motivo) throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("itemId", itemId.toString());
        cuerpo.put("cantidad", cantidad);
        if (motivo != null) {
            cuerpo.put("motivo", motivo);
        }
        return mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(cuerpo)));
    }

    @Test
    @DisplayName("R1: el retiro guarda su motivo, la cantidad y quién lo hizo")
    void retiroGuardaMotivo() throws Exception {
        retirar(tokenAdmin(), 2, "  Entrega al albergue de Suba  ")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.disponible").value(DISPONIBLE_INICIAL - 2));

        List<RetiroInventarioJpaEntity> retiros = retiroInventarioJpaRepository.findByItemIdOrderByRetiradoEnDesc(itemId);
        assertEquals(1, retiros.size(), "un retiro, un registro");
        RetiroInventarioJpaEntity retiro = retiros.get(0);
        assertEquals("Entrega al albergue de Suba", retiro.getMotivo());
        assertEquals(2, retiro.getCantidad());
        assertEquals(centroId, retiro.getCentroAcopioId());
        assertEquals(usuarioDe(ADMIN).getId(), retiro.getUsuarioId());
    }

    @Test
    @DisplayName("R2: un motivo de más de 255 caracteres es 400 y no retira nada")
    void motivoLargoEsRechazado() throws Exception {
        retirar(tokenAdmin(), 1, "x".repeat(256))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        assertEquals(DISPONIBLE_INICIAL, itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible());
        assertTrue(retiroInventarioJpaRepository.findByItemIdOrderByRetiradoEnDesc(itemId).isEmpty());
    }

    @Test
    @DisplayName("R3: un cliente que no envía motivo sigue funcionando; el retiro queda sin motivo")
    void sinMotivoSigueFuncionando() throws Exception {
        retirar(tokenAdmin(), 1, null).andExpect(status().isOk());

        List<RetiroInventarioJpaEntity> retiros = retiroInventarioJpaRepository.findByItemIdOrderByRetiradoEnDesc(itemId);
        assertEquals(1, retiros.size());
        assertNull(retiros.get(0).getMotivo());
    }
}
