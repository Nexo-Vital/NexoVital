package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * El administrador de plataforma se precarga al arrancar (EP-06.F2.US1, T10).
 * Con dos réplicas arrancando a la vez sobre una base vacía, las dos intentan
 * insertarlo: la que pierde no debe tumbar el arranque.
 */
@ExtendWith(MockitoExtension.class)
class AdministradorPlataformaInicialTest {

    private static final String CORREO = "admin@nexovital.co";

    @Mock
    private UsuarioRepository usuarioRepository;

    @Mock
    private PasswordEncoderPort passwordEncoderPort;

    @Test
    void sinCorreoConfiguradoNoCreaNadie() {
        AdministradorPlataformaInicial inicial =
                new AdministradorPlataformaInicial(usuarioRepository, passwordEncoderPort, "   ");

        inicial.run(null);

        verifyNoInteractions(usuarioRepository, passwordEncoderPort);
    }

    @Test
    void siYaExisteNoLoVuelveACrear() {
        when(usuarioRepository.existePorEmail(CORREO)).thenReturn(true);
        AdministradorPlataformaInicial inicial =
                new AdministradorPlataformaInicial(usuarioRepository, passwordEncoderPort, CORREO);

        inicial.run(null);

        verify(usuarioRepository, never()).guardar(any());
    }

    @Test
    void creaElAdministradorConElRolDePlataformaYElCorreoNormalizado() {
        when(usuarioRepository.existePorEmail(CORREO)).thenReturn(false);
        when(passwordEncoderPort.encriptar(anyString())).thenReturn("hash");
        AdministradorPlataformaInicial inicial = new AdministradorPlataformaInicial(
                usuarioRepository, passwordEncoderPort, "  Admin@NexoVital.co ");

        inicial.run(null);

        ArgumentCaptor<Usuario> guardado = ArgumentCaptor.forClass(Usuario.class);
        verify(usuarioRepository).guardar(guardado.capture());
        assertEquals(CORREO, guardado.getValue().getEmail());
        assertEquals(RolUsuario.ADMIN_PLATAFORMA, guardado.getValue().getRol());
        assertEquals("hash", guardado.getValue().getPasswordHash());
    }

    @Test
    void siOtraReplicaLoCreoPrimeroNoEsUnErrorDeArranque() {
        when(usuarioRepository.existePorEmail(CORREO)).thenReturn(false);
        when(passwordEncoderPort.encriptar(anyString())).thenReturn("hash");
        when(usuarioRepository.guardar(any())).thenThrow(new DataIntegrityViolationException("email duplicado"));
        AdministradorPlataformaInicial inicial =
                new AdministradorPlataformaInicial(usuarioRepository, passwordEncoderPort, CORREO);

        assertDoesNotThrow(() -> inicial.run(null));
    }
}
