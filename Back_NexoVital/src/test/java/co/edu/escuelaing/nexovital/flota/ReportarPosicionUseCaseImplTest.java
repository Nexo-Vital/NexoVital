package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.ReportarPosicionUseCaseImpl;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.event.PosicionActualizadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit cases of the state a position report publishes (EP-04.F1.US4 /
 * EP-04.F2.US7).
 *
 * <p>The report must announce the state the unit has AFTER the position write,
 * not the one read before it. Otherwise a report racing with an accept publishes
 * AVAILABLE after the ASSIGNED frame and the map paints a busy unit as free.
 */
@ExtendWith(MockitoExtension.class)
class ReportarPosicionUseCaseImplTest {

    private static final double LAT = 4.7421d;
    private static final double LNG = -74.0835d;

    @Mock
    private AmbulanciaRepository ambulanciaRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    private final UUID unidad = UUID.randomUUID();
    private final UUID conductor = UUID.randomUUID();

    private ReportarPosicionUseCaseImpl useCase;

    @BeforeEach
    void setUp() {
        useCase = new ReportarPosicionUseCaseImpl(ambulanciaRepository, eventPublisher);
    }

    @Test
    @DisplayName("Si la unidad pasa a EN_MISION durante el reporte, el evento publica EN_MISION y no el estado leido antes")
    void publicaElEstadoLeidoDespuesDelUpdate() {
        // First read: still free. Second read (after the UPDATE): an accept
        // committed in between and the unit is now in a mission.
        when(ambulanciaRepository.buscarPorId(unidad)).thenReturn(
                Optional.of(unidadEn(EstadoAmbulancia.DISPONIBLE, 4.70d, -74.05d, 3L)),
                Optional.of(unidadEn(EstadoAmbulancia.EN_MISION, LAT, LNG, 5L)));
        when(ambulanciaRepository.actualizarPosicionAtomica(unidad, LAT, LNG)).thenReturn(1);

        Ambulancia resultado = useCase.reportarPosicion(
                unidad, conductor, LAT, LNG, 90, FuentePosicion.DEVICE);

        ArgumentCaptor<PosicionActualizadaEvent> evento =
                ArgumentCaptor.forClass(PosicionActualizadaEvent.class);
        verify(eventPublisher).publishEvent(evento.capture());

        assertEquals(EstadoAmbulancia.EN_MISION, evento.getValue().estado(),
                "el aviso de posicion debe llevar el estado vigente tras el UPDATE");
        assertEquals(LAT, evento.getValue().lat());
        assertEquals(LNG, evento.getValue().lng());
        assertEquals(EstadoAmbulancia.EN_MISION, resultado.getEstado(),
                "la respuesta REST tambien refleja el estado vigente");
    }

    @Test
    @DisplayName("Sin cambios concurrentes, el reporte conserva el estado de la unidad")
    void conservaElEstadoCuandoNadaCambia() {
        when(ambulanciaRepository.buscarPorId(unidad)).thenReturn(
                Optional.of(unidadEn(EstadoAmbulancia.EN_MISION, 4.70d, -74.05d, 3L)),
                Optional.of(unidadEn(EstadoAmbulancia.EN_MISION, LAT, LNG, 4L)));
        when(ambulanciaRepository.actualizarPosicionAtomica(unidad, LAT, LNG)).thenReturn(1);

        Ambulancia resultado = useCase.reportarPosicion(
                unidad, conductor, LAT, LNG, null, FuentePosicion.SIMULADA);

        ArgumentCaptor<PosicionActualizadaEvent> evento =
                ArgumentCaptor.forClass(PosicionActualizadaEvent.class);
        verify(eventPublisher).publishEvent(evento.capture());

        assertEquals(EstadoAmbulancia.EN_MISION, evento.getValue().estado());
        assertEquals(LAT, resultado.getLat());
        assertEquals(LNG, resultado.getLng());
    }

    private Ambulancia unidadEn(EstadoAmbulancia estado, double lat, double lng, long version) {
        return new Ambulancia(unidad, "NVX-001", estado, lat, lng, "suba", conductor, version);
    }
}
