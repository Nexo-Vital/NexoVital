package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Con dos instancias, la simulación corre en ambas y cada ambulancia se mueve
 * dos veces por ciclo. El bloqueo es lo que evita ese duplicado: si otra
 * instancia lo tiene, esta no debe ni consultar la flota.
 */
@ExtendWith(MockitoExtension.class)
class FlotaSimulationSchedulerTest {

    @Mock
    private FlotaQueryPort flotaQueryPort;

    @Mock
    private ReportarPosicionUseCase reportarPosicionUseCase;

    @Test
    void noSimulaCuandoOtraInstanciaTieneElBloqueo() {
        FlotaSimulationScheduler simulador =
                new FlotaSimulationScheduler(flotaQueryPort, reportarPosicionUseCase, (nombre, vigencia) -> false);

        simulador.simularMovimiento();

        verifyNoInteractions(flotaQueryPort, reportarPosicionUseCase);
    }
}
