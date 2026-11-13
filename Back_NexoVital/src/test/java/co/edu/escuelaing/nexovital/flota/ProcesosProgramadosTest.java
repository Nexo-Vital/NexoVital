package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarLlegadasVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DetectarSenalPerdidaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.ConfirmacionAutomaticaScheduler;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.SenalFlotaScheduler;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.SolicitudExpiryScheduler;
import co.edu.escuelaing.nexovital.infrastructure.bloqueo.EjecucionUnica;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Sprint 2, T05: every scheduled sweep must run on a single instance across the
 * balancer. These tests pin the two halves of the contract for each sweep: the
 * one that owns the lock runs it, and the one that loses the lock does nothing.
 */
@ExtendWith(MockitoExtension.class)
class ProcesosProgramadosTest {

    @Mock
    private EjecucionUnica ejecucionUnica;

    @Mock
    private DetectarSenalPerdidaUseCase detectarSenalPerdidaUseCase;

    @Mock
    private ConfirmarLlegadasVencidasUseCase confirmarLlegadasVencidasUseCase;

    @Mock
    private ExpirarSolicitudesVencidasUseCase expirarSolicitudesVencidasUseCase;

    @Test
    void elBarridoDeSenalCorreCuandoTomaElBloqueo() {
        when(ejecucionUnica.intentar(anyString(), any(Duration.class))).thenReturn(true);

        new SenalFlotaScheduler(detectarSenalPerdidaUseCase, ejecucionUnica).detectarSenalPerdida();

        verify(detectarSenalPerdidaUseCase).detectar();
    }

    @Test
    void elBarridoDeSenalNoCorreSiOtraInstanciaTieneElBloqueo() {
        when(ejecucionUnica.intentar(anyString(), any(Duration.class))).thenReturn(false);

        new SenalFlotaScheduler(detectarSenalPerdidaUseCase, ejecucionUnica).detectarSenalPerdida();

        verifyNoInteractions(detectarSenalPerdidaUseCase);
    }

    @Test
    void laConfirmacionAutomaticaCorreCuandoTomaElBloqueo() {
        when(ejecucionUnica.intentar(anyString(), any(Duration.class))).thenReturn(true);

        new ConfirmacionAutomaticaScheduler(confirmarLlegadasVencidasUseCase, ejecucionUnica)
                .confirmarLlegadasVencidas();

        verify(confirmarLlegadasVencidasUseCase).confirmarVencidas();
    }

    @Test
    void laConfirmacionAutomaticaNoCorreSiOtraInstanciaTieneElBloqueo() {
        when(ejecucionUnica.intentar(anyString(), any(Duration.class))).thenReturn(false);

        new ConfirmacionAutomaticaScheduler(confirmarLlegadasVencidasUseCase, ejecucionUnica)
                .confirmarLlegadasVencidas();

        verify(confirmarLlegadasVencidasUseCase, never()).confirmarVencidas();
    }

    @Test
    void laExpiracionCorreCuandoTomaElBloqueo() {
        when(ejecucionUnica.intentar(anyString(), any(Duration.class))).thenReturn(true);

        new SolicitudExpiryScheduler(expirarSolicitudesVencidasUseCase, ejecucionUnica)
                .expirarSolicitudesVencidas();

        verify(expirarSolicitudesVencidasUseCase).expirarVencidas();
    }

    @Test
    void laExpiracionNoCorreSiOtraInstanciaTieneElBloqueo() {
        when(ejecucionUnica.intentar(anyString(), any(Duration.class))).thenReturn(false);

        new SolicitudExpiryScheduler(expirarSolicitudesVencidasUseCase, ejecucionUnica)
                .expirarSolicitudesVencidas();

        verify(expirarSolicitudesVencidasUseCase, never()).expirarVencidas();
    }
}
