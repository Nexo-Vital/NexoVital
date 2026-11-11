package co.edu.escuelaing.nexovital.observabilidad;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.EventoAuditoriaJpaRepository;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out.EmergenciaJpaRepository;
import co.edu.escuelaing.nexovital.observabilidad.infrastructure.IndicadoresNegocioMetricas;
import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarSemaforoCentrosUseCase;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
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
 * Sprint 2, T43: los gauges del tablero de negocio coinciden con lo que guarda
 * la base. Se hace una donación real por HTTP y se compara cada gauge con un
 * conteo hecho por los repositorios JPA, que es un camino distinto al SQL del
 * adaptador.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class})
class IndicadoresNegocioMetricasTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String PREFIJO_PRUEBA = "Indicador T43 ";

    @Autowired
    private MeterRegistry registro;

    @Autowired
    private IndicadoresNegocioMetricas indicadores;

    @Autowired
    private EventoAuditoriaJpaRepository eventoAuditoriaJpaRepository;

    @Autowired
    private EmergenciaJpaRepository emergenciaJpaRepository;

    @Autowired
    private ConsultarSemaforoCentrosUseCase semaforoCentros;

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
    @DisplayName("T43: una donación sube el gauge en 1 y el gauge coincide con la bitácora")
    void elGaugeDeDonacionesCoincideConLaBitacora() throws Exception {
        indicadores.refrescar();
        double antes = gauge("nexovital.negocio.donaciones.completadas");

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + tokenDe(CIUDADANO, CIUDADANO_PASSWORD))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 5))))
                .andExpect(status().isOk());

        indicadores.refrescar();
        long enLaBase = eventoAuditoriaJpaRepository.findAll().stream()
                .filter(evento -> evento.getAccion() == AccionCritica.INSUMO_DONADO)
                .count();

        assertEquals(antes + 1, gauge("nexovital.negocio.donaciones.completadas"), 0.0);
        assertEquals(enLaBase, gauge("nexovital.negocio.donaciones.completadas"), 0.0);
    }

    @Test
    @DisplayName("T43: emergencias y centros por semáforo coinciden con la base")
    void emergenciasYSemaforoCoincidenConLaBase() {
        indicadores.refrescar();

        assertEquals(emergenciaJpaRepository.count(),
                gauge("nexovital.negocio.emergencias.reportadas"), 0.0);

        Map<UUID, Semaforo> porCentro = semaforoCentros.consultar();
        for (Semaforo nivel : Semaforo.values()) {
            long esperados = porCentro.values().stream().filter(nivel::equals).count();
            double publicado = registro.get("nexovital.negocio.centros")
                    .tag("semaforo", nivel.name())
                    .gauge()
                    .value();
            assertEquals(esperados, publicado, 0.0, "centros en " + nivel);
        }
    }

    private double gauge(String nombre) {
        return registro.get(nombre).gauge().value();
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
