package co.edu.escuelaing.nexovital.mapa;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaEntity;
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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * El disparador del despacho vive en el BACK: reportar una emergencia crea la
 * solicitud de ambulancia, sin que el cliente tenga que pedirla aparte.
 *
 * <p>La prueba atraviesa el puerto de entrada real y verifica el efecto
 * observable en la persistencia: la solicitud existe, esta PENDIENTE, apunta a
 * la emergencia reportada y pertenece al usuario que la reporto.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class ReporteEmergenciaDespachaTest {

    @Autowired
    private ReportarEmergenciaUseCase reportarEmergenciaUseCase;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private SolicitudJpaRepository solicitudJpaRepository;

    private final List<UUID> unidadesSembradas = new ArrayList<>();
    private UUID solicitudCreada;

    @AfterEach
    void limpiar() {
        if (solicitudCreada != null) {
            solicitudJpaRepository.deleteById(solicitudCreada);
        }
        if (!unidadesSembradas.isEmpty()) {
            ambulanciaJpaRepository.deleteAllById(unidadesSembradas);
        }
    }

    @Test
    @DisplayName("Reportar una emergencia crea la solicitud de ambulancia en el backend")
    void reporteDespachaLaSolicitud() {
        sembrarUnidadDisponible();
        UUID solicitante = UUID.randomUUID();
        ReportarEmergenciaUseCase.EmergenciaReportada reportada = reportarEmergenciaUseCase.reportar(
                new Ubicacion(4.73d, -74.08d),
                TipoEmergencia.INCENDIO,
                NivelEmergencia.ALTO,
                "Humo en el tercer piso",
                "Calle 1 #2-3",
                solicitante);

        solicitudCreada = reportada.solicitudId();
        assertNotNull(solicitudCreada,
                "el reporte debe crear la solicitud: el despacho vive en el backend");

        SolicitudJpaEntity solicitud = solicitudJpaRepository.findById(solicitudCreada).orElseThrow();
        assertEquals(reportada.emergencia().getId(), solicitud.getEmergenciaId(),
                "la solicitud creada referencia la emergencia reportada");
        assertEquals(EstadoSolicitud.PENDIENTE, solicitud.getEstado(),
                "nace PENDIENTE: la aceptacion sigue siendo la carrera del C2");
        assertEquals(solicitante, solicitud.getSolicitanteId(),
                "el solicitante es el usuario que reporto");
        assertEquals("Calle 1 #2-3", solicitud.getDireccion(),
                "la direccion del reporte viaja a la solicitud");
        assertEquals(-74.08d, solicitud.getLng(), 1e-9,
                "el punto de recogida es el de la emergencia");
    }

    /**
     * Seeds one available unit, the way the C2 tests do: the fleet repository
     * accepts the entity directly and the candidate query picks it up.
     */
    private UUID sembrarUnidadDisponible() {
        UUID id = UUID.randomUUID();
        UUID conductorId = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                id, "TST" + id.toString().substring(0, 4), EstadoAmbulancia.DISPONIBLE,
                4.73d, -74.08d, "PruebaDespacho-" + UUID.randomUUID(), conductorId));
        unidadesSembradas.add(id);
        return id;
    }
}
