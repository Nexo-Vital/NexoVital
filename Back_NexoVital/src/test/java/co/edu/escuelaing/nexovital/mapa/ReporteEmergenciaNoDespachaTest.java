package co.edu.escuelaing.nexovital.mapa;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ReportarEmergenciaUseCase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Reportar una zona afectada alerta a los centros de ayuda (EP-02.F1.US3); NO
 * pide ambulancia. Pedirla es otra accion del ciudadano ({@code POST
 * /solicitudes}, EP-04.F2.US1).
 *
 * <p>Se siembra una unidad disponible a proposito: aun pudiendo despacharse,
 * el reporte no debe crear ninguna solicitud.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class ReporteEmergenciaNoDespachaTest {

    @Autowired
    private ReportarEmergenciaUseCase reportarEmergenciaUseCase;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private SolicitudJpaRepository solicitudJpaRepository;

    private UUID unidadSembrada;

    @AfterEach
    void limpiar() {
        if (unidadSembrada != null) {
            ambulanciaJpaRepository.deleteById(unidadSembrada);
        }
    }

    @Test
    @DisplayName("Reportar una emergencia no crea una solicitud de ambulancia")
    void reporteNoDespacha() {
        unidadSembrada = sembrarUnidadDisponible();

        ReportarEmergenciaUseCase.EmergenciaReportada reportada = reportarEmergenciaUseCase.reportar(
                new Ubicacion(4.73d, -74.08d),
                TipoEmergencia.INCENDIO,
                NivelEmergencia.ALTO,
                "Humo en el tercer piso",
                "Calle 1 #2-3",
                UUID.randomUUID());

        assertNotNull(reportada.emergencia().getId(), "la emergencia queda registrada");
        assertNull(reportada.solicitudId(), "reportar no devuelve una solicitud");
        UUID emergenciaId = reportada.emergencia().getId();
        assertFalse(solicitudJpaRepository.findAll().stream()
                        .anyMatch(solicitud -> emergenciaId.equals(solicitud.getEmergenciaId())),
                "ninguna solicitud de ambulancia apunta a la emergencia reportada");
    }

    private UUID sembrarUnidadDisponible() {
        UUID id = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                id, "TST" + id.toString().substring(0, 4), EstadoAmbulancia.DISPONIBLE,
                4.73d, -74.08d, "PruebaReporte-" + UUID.randomUUID(), UUID.randomUUID()));
        return id;
    }
}
