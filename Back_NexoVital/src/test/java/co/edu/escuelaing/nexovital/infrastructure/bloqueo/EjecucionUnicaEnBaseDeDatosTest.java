package co.edu.escuelaing.nexovital.infrastructure.bloqueo;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * La exclusión mutua tiene tres caminos: el UPDATE gana, la fila no existe y se
 * inserta, o dos instancias insertan a la vez y una pierde por la clave
 * primaria. El tercero es el que importa: si la excepción escapara, el ciclo
 * entero se caería en lugar de ceder el turno.
 */
@ExtendWith(MockitoExtension.class)
class EjecucionUnicaEnBaseDeDatosTest {

    private static final Duration VIGENCIA = Duration.ofSeconds(15);

    @Mock
    private BloqueoEjecucionJpaRepository repositorio;

    @Test
    void tomaElBloqueoCuandoElUpdateCondicionalGana() {
        when(repositorio.tomar(anyString(), anyString(), any(), any())).thenReturn(1);

        assertTrue(new EjecucionUnicaEnBaseDeDatos(repositorio).intentar("tarea", VIGENCIA));
    }

    @Test
    void creaLaFilaLaPrimeraVez() {
        when(repositorio.tomar(anyString(), anyString(), any(), any())).thenReturn(0);
        when(repositorio.saveAndFlush(any())).thenAnswer(invocacion -> invocacion.getArgument(0));

        assertTrue(new EjecucionUnicaEnBaseDeDatos(repositorio).intentar("tarea", VIGENCIA));
    }

    @Test
    void cedeElTurnoCuandoOtraInstanciaInsertoPrimero() {
        when(repositorio.tomar(anyString(), anyString(), any(), any())).thenReturn(0);
        when(repositorio.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("clave duplicada"));

        assertFalse(new EjecucionUnicaEnBaseDeDatos(repositorio).intentar("tarea", VIGENCIA));
        verify(repositorio, times(2)).tomar(anyString(), anyString(), any(), any());
    }

    @Test
    void reintentaElUpdateSiLaOtraInstanciaYaVencio() {
        when(repositorio.tomar(anyString(), anyString(), any(), any())).thenReturn(0, 1);
        when(repositorio.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("clave duplicada"));

        assertTrue(new EjecucionUnicaEnBaseDeDatos(repositorio).intentar("tarea", VIGENCIA));
    }
}
