package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.FlotaSimulationScheduler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Configuration and behaviour of the fleet simulator (EP-04.F1.US1, design
 * D2/D3).
 *
 * <p>The context runner proves the two barriers WITHOUT booting the whole app:
 * the bean does not exist unless the property is {@code true}, and it does not
 * exist even with the property forced to {@code true} when {@code prod} is
 * active. The behaviour test proves the simulator routes through the SAME
 * {@link ReportarPosicionUseCase} the driver uses (there is no direct repository
 * write), that it moves every ACTIVE unit (a unit in a mission too) and that it
 * steps aside for a unit a real device is reporting.
 */
class SimulacionFlotaTest {

    private final FlotaQueryPort flotaQueryPort = mock(FlotaQueryPort.class);
    private final ReportarPosicionUseCase reportarPosicionUseCase = mock(ReportarPosicionUseCase.class);

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
                .withBean(FlotaQueryPort.class, () -> flotaQueryPort)
                .withBean(ReportarPosicionUseCase.class, () -> reportarPosicionUseCase)
                .withUserConfiguration(FlotaSimulationScheduler.class);
    }

    @Test
    @DisplayName("Sin la propiedad el simulador no existe (el bean exige enabled=true)")
    void sinPropiedadNoExiste() {
        runner().run(context ->
                assertThat(context).doesNotHaveBean(FlotaSimulationScheduler.class));
    }

    @Test
    @DisplayName("AC6: el simulador no corre en prod aunque se fuerce la propiedad")
    void nuncaCorreEnProd() {
        runner()
                .withInitializer(context -> context.getEnvironment().setActiveProfiles("prod"))
                .withPropertyValues("nexovital.flota.simulacion.enabled=true")
                .run(context ->
                        assertThat(context).doesNotHaveBean(FlotaSimulationScheduler.class));
    }

    @Test
    @DisplayName("AC6: con la propiedad en true el simulador existe (fuera de prod)")
    void encendidoExiste() {
        runner()
                .withPropertyValues("nexovital.flota.simulacion.enabled=true")
                .run(context ->
                        assertThat(context).hasSingleBean(FlotaSimulationScheduler.class));
    }

    @Test
    @DisplayName("Mueve toda unidad activa por el mismo caso de uso, y omite mantenimiento, sin conductor y tomadas por un dispositivo")
    void mueveLasActivasYOmiteElResto() {
        UUID idDisponible = UUID.randomUUID();
        UUID conductorDisponible = UUID.randomUUID();
        Ambulancia disponible = new Ambulancia(idDisponible, "SIM1", EstadoAmbulancia.DISPONIBLE,
                4.70d, -74.00d, "Suba", conductorDisponible, 0);

        // A unit in a mission keeps moving: position is data, not a state.
        UUID idEnMision = UUID.randomUUID();
        UUID conductorEnMision = UUID.randomUUID();
        Ambulancia enMision = new Ambulancia(idEnMision, "SIM2", EstadoAmbulancia.EN_MISION,
                4.71d, -74.01d, "Suba", conductorEnMision, 0);

        UUID idSinConductor = UUID.randomUUID();
        Ambulancia sinConductor = new Ambulancia(idSinConductor, "SIM3", EstadoAmbulancia.DISPONIBLE,
                4.72d, -74.02d, "Suba", null, 0);

        UUID idMantenimiento = UUID.randomUUID();
        Ambulancia enMantenimiento = new Ambulancia(idMantenimiento, "SIM4", EstadoAmbulancia.MANTENIMIENTO,
                4.73d, -74.03d, "Suba", UUID.randomUUID(), 0);

        // The last report of this unit came from a real device: the driver owns it.
        UUID idDeDispositivo = UUID.randomUUID();
        Ambulancia deDispositivo = new Ambulancia(idDeDispositivo, "SIM5", EstadoAmbulancia.DISPONIBLE,
                4.74d, -74.04d, "Suba", UUID.randomUUID(), 3,
                Instant.parse("2026-10-06T12:00:00Z"), FuentePosicion.DEVICE, false);

        // A unit the simulator itself moved before stays simulable.
        UUID idYaSimulada = UUID.randomUUID();
        UUID conductorYaSimulada = UUID.randomUUID();
        Ambulancia yaSimulada = new Ambulancia(idYaSimulada, "SIM6", EstadoAmbulancia.DISPONIBLE,
                4.75d, -74.05d, "Suba", conductorYaSimulada, 7,
                Instant.parse("2026-10-06T12:00:00Z"), FuentePosicion.SIMULADA, false);

        when(flotaQueryPort.consultarFlota()).thenReturn(List.of(
                disponible, enMision, sinConductor, enMantenimiento, deDispositivo, yaSimulada));

        runner()
                .withPropertyValues("nexovital.flota.simulacion.enabled=true")
                .run(context -> {
                    FlotaSimulationScheduler scheduler =
                            context.getBean(FlotaSimulationScheduler.class);
                    scheduler.simularMovimiento();
                });

        ArgumentCaptor<Double> latCaptor = ArgumentCaptor.forClass(Double.class);
        ArgumentCaptor<Double> lngCaptor = ArgumentCaptor.forClass(Double.class);
        verify(reportarPosicionUseCase).reportarPosicion(
                eq(idDisponible), eq(conductorDisponible),
                latCaptor.capture(), lngCaptor.capture(), any(), eq(FuentePosicion.SIMULADA));

        // It moved, and it kept its coordinates nonzero (a real nudge).
        assertNotEquals(4.70d, latCaptor.getValue());
        assertNotEquals(-74.00d, lngCaptor.getValue());

        // The unit in a mission and the one already simulated are moved too.
        verify(reportarPosicionUseCase).reportarPosicion(
                eq(idEnMision), eq(conductorEnMision),
                anyDouble(), anyDouble(), any(), eq(FuentePosicion.SIMULADA));
        verify(reportarPosicionUseCase).reportarPosicion(
                eq(idYaSimulada), eq(conductorYaSimulada),
                anyDouble(), anyDouble(), any(), eq(FuentePosicion.SIMULADA));

        // A driverless unit has no actor to report as; a unit under maintenance
        // is not active; a unit a device reports belongs to its driver.
        verify(reportarPosicionUseCase, never()).reportarPosicion(
                eq(idSinConductor), any(), anyDouble(), anyDouble(), any(), any());
        verify(reportarPosicionUseCase, never()).reportarPosicion(
                eq(idMantenimiento), any(), anyDouble(), anyDouble(), any(), any());
        verify(reportarPosicionUseCase, never()).reportarPosicion(
                eq(idDeDispositivo), any(), anyDouble(), anyDouble(), any(), any());
    }
}
