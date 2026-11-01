package co.edu.escuelaing.nexovital.auditoria;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.auditoria.domain.model.EventoAuditoria;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.RegistroAuditoriaPort;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Casos HTTP de la bitácora de auditoría (Maintain Audit Trail).
 *
 * <p>Cubre lo que el escenario promete y lo que un fallo silencioso rompería: sin
 * token no se entra (401), un rol que no es de administración no entra (403), un
 * recurso sin eventos devuelve una lista vacía y no un 404, y la traza vuelve en
 * orden cronológico.
 *
 * <p>La emisión desde el despacho de stock se ejerce en la suite de recursos; acá
 * se prueba el contrato del adaptador y del endpoint.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class AuditoriaHttpTest extends LoginTestBase {

    private static final String ADMIN = "admin@nexovital.co";
    private static final String ADMIN_PASSWORD = "admin123";
    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";

    @Autowired
    private RegistroAuditoriaPort registroAuditoriaPort;

    @Test
    @DisplayName("Sin token la bitacora responde 401")
    void sinTokenResponde401() throws Exception {
        mockMvc.perform(get("/api/v1/auditoria/centros/{id}", UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Un ciudadano autenticado no puede leer la bitacora (403)")
    void ciudadanoNoPuedeLeer() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(get("/api/v1/auditoria/centros/{id}", UUID.randomUUID())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Un recurso sin eventos devuelve 200 con lista vacia, no 404")
    void recursoSinEventosDevuelveListaVacia() throws Exception {
        String token = tokenDe(ADMIN, ADMIN_PASSWORD);

        mockMvc.perform(get("/api/v1/auditoria/emergencias/{id}", UUID.randomUUID())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @DisplayName("La traza vuelve en orden cronologico, del mas viejo al mas nuevo")
    void trazaEnOrdenCronologico() throws Exception {
        UUID centroId = UUID.randomUUID();
        Instant base = Instant.parse("2026-11-01T12:00:00Z");

        // Se registran al reves a proposito: el orden lo tiene que imponer la
        // consulta, no el orden de insercion.
        registroAuditoriaPort.registrar(EventoAuditoria.nuevo(
                AccionCritica.INSUMO_DESPACHADO, EventoAuditoria.TIPO_CENTRO, centroId,
                null, "segundo", base.plusSeconds(60)));
        registroAuditoriaPort.registrar(EventoAuditoria.nuevo(
                AccionCritica.INSUMO_DONADO, EventoAuditoria.TIPO_CENTRO, centroId,
                null, "primero", base));

        String token = tokenDe(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(get("/api/v1/auditoria/centros/{id}", centroId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].detalle").value("primero"))
                .andExpect(jsonPath("$[0].accion").value("INSUMO_DONADO"))
                .andExpect(jsonPath("$[1].detalle").value("segundo"))
                .andExpect(jsonPath("$[1].accion").value("INSUMO_DESPACHADO"));
    }

    /** Abre una sesión real y devuelve el Bearer, como hace el cliente. */
    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
