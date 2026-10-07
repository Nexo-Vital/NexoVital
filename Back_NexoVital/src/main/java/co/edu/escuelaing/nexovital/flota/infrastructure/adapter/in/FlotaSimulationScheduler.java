package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Simulated position feed of the fleet (EP-04.F1.US1, design D2/D3): every
 * cycle (5 s by default) it nudges each ACTIVE unit a few tens of metres, so the
 * map shows a fleet that moves and every unit keeps reporting.
 *
 * <p><b>Which units.</b> Every unit except the ones in {@code MANTENIMIENTO},
 * with a driver assigned. A unit in a mission moves too: position is data, not
 * a state.
 *
 * <p><b>The device wins (D3).</b> A unit whose last report came from a real
 * device is skipped: the driver is reporting it, and two sources would make it
 * jump. The filter here only saves work; the rule itself is enforced by the
 * conditional UPDATE the use case runs for a simulated report, so a device that
 * reports between this read and the write is never overwritten. A unit owned by
 * a device that stops reporting is therefore NOT rescued by the simulator: it
 * loses its signal, which is exactly the signal-loss scenario.
 *
 * <p><b>On by property.</b> {@code @ConditionalOnProperty(
 * nexovital.flota.simulacion.enabled=true)} makes the bean exist only when the
 * property is {@code true}. {@code application.properties} turns it on for
 * development and the {@code test} profile turns it off.
 *
 * <p><b>Never in {@code prod}.</b> {@code @Profile("!prod")} excludes it even if
 * the property is forced to {@code true}, the same double barrier the data
 * seeder uses.
 *
 * <p><b>No privileged path.</b> It does not write the fleet itself: it calls the
 * SAME {@link ReportarPosicionUseCase} the driver's REST route calls, reporting
 * as each unit's assigned driver with {@link FuentePosicion#SIMULADA}. The
 * ownership check, the "the state never changes" rule and the post-commit push
 * are therefore the very same ones the driver path exercises.
 */
@Component
@Profile("!prod")
@ConditionalOnProperty(prefix = "nexovital.flota.simulacion", name = "enabled", havingValue = "true")
public class FlotaSimulationScheduler {

    private static final Logger LOG = LoggerFactory.getLogger(FlotaSimulationScheduler.class);

    /** Step radius per cycle, in degrees (~33 m): a small, map-noticeable nudge. */
    private static final double RADIO_PASO_GRADOS = 0.0003d;

    private final FlotaQueryPort flotaQueryPort;
    private final ReportarPosicionUseCase reportarPosicionUseCase;

    public FlotaSimulationScheduler(FlotaQueryPort flotaQueryPort,
                                    ReportarPosicionUseCase reportarPosicionUseCase) {
        this.flotaQueryPort = flotaQueryPort;
        this.reportarPosicionUseCase = reportarPosicionUseCase;
    }

    @Scheduled(
            initialDelayString = "${nexovital.flota.simulacion.delay-inicial-ms:5000}",
            fixedDelayString = "${nexovital.flota.simulacion.intervalo-ms:5000}")
    public void simularMovimiento() {
        List<Ambulancia> simulables = flotaQueryPort.consultarFlota().stream()
                // A unit under maintenance is not active: it does not move.
                .filter(unidad -> unidad.getEstado() != EstadoAmbulancia.MANTENIMIENTO)
                // A unit with no driver has no actor to report as: skip it instead
                // of inventing one. The ownership check would refuse it anyway.
                .filter(unidad -> unidad.getConductorId() != null)
                // A real device is reporting this unit: the simulator steps aside.
                .filter(unidad -> unidad.getFuentePosicion() != FuentePosicion.DEVICE)
                .toList();

        for (Ambulancia unidad : simulables) {
            try {
                double rumbo = ThreadLocalRandom.current().nextDouble(0.0d, 360.0d);
                double radianes = Math.toRadians(rumbo);
                double nuevaLat = unidad.getLat() + RADIO_PASO_GRADOS * Math.cos(radianes);
                double nuevaLng = unidad.getLng() + RADIO_PASO_GRADOS * Math.sin(radianes);
                reportarPosicionUseCase.reportarPosicion(
                        unidad.getId(), unidad.getConductorId(),
                        nuevaLat, nuevaLng, (int) Math.round(rumbo), FuentePosicion.SIMULADA);
            } catch (RuntimeException e) {
                // One unit failing must not abort the rest: retry on the next cycle.
                LOG.warn("Fallo al simular el movimiento de la ambulancia {}", unidad.getId(), e);
            }
        }
    }
}
