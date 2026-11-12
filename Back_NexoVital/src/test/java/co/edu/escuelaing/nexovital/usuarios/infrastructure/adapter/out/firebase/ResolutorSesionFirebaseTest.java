package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Cómo un token de Google se convierte en un usuario de NexoVital (T10/T12):
 * por uid, por enlace con el correo verificado (administrador precargado) o, si
 * no hay usuario, "no registrado".
 */
class ResolutorSesionFirebaseTest {

    private static final String TOKEN = "token-google";

    private final Usuario admin = new Usuario(
            UUID.randomUUID(), "Administrador de plataforma", "nexovital1@gmail.com", "h", RolUsuario.ADMIN_PLATAFORMA);

    private ValidadorTokenFirebase validador;
    private UsuarioRepository usuarios;
    private ResolutorSesionFirebase resolutor;

    @BeforeEach
    void preparar() {
        validador = mock(ValidadorTokenFirebase.class);
        usuarios = mock(UsuarioRepository.class);
        when(usuarios.buscarPorFirebaseUid(anyString())).thenReturn(Optional.empty());
        when(usuarios.buscarPorEmailSinEnlazar(anyString())).thenReturn(Optional.empty());
        resolutor = new ResolutorSesionFirebase(validador, usuarios);
    }

    @Test
    @DisplayName("Uid ya enlazado: devuelve su usuario sin tocar nada")
    void resuelvePorUid() {
        when(validador.validarIdentidad(TOKEN)).thenReturn(new IdentidadExterna("uid-admin", "x@gmail.com", true, null));
        when(usuarios.buscarPorFirebaseUid("uid-admin")).thenReturn(Optional.of(admin));

        assertEquals(admin, resolutor.resolver(TOKEN));
        verify(usuarios, never()).enlazarFirebaseUid(admin.getId(), "uid-admin");
    }

    @Test
    @DisplayName("Primer ingreso del administrador precargado: se enlaza por correo verificado")
    void enlazaPorCorreoVerificado() {
        when(validador.validarIdentidad(TOKEN))
                .thenReturn(new IdentidadExterna("uid-nuevo", "nexovital1@gmail.com", true, "Admin"));
        when(usuarios.buscarPorEmailSinEnlazar("nexovital1@gmail.com")).thenReturn(Optional.of(admin));

        assertEquals(RolUsuario.ADMIN_PLATAFORMA, resolutor.resolver(TOKEN).getRol());
        verify(usuarios).enlazarFirebaseUid(admin.getId(), "uid-nuevo");
    }

    @Test
    @DisplayName("Correo NO verificado: no se enlaza y la cuenta queda como no registrada")
    void noEnlazaSinCorreoVerificado() {
        when(validador.validarIdentidad(TOKEN))
                .thenReturn(new IdentidadExterna("uid-nuevo", "nexovital1@gmail.com", false, null));
        when(usuarios.buscarPorEmailSinEnlazar("nexovital1@gmail.com")).thenReturn(Optional.of(admin));

        assertThrows(UsuarioNoRegistradoException.class, () -> resolutor.resolver(TOKEN));
        verify(usuarios, never()).enlazarFirebaseUid(admin.getId(), "uid-nuevo");
    }

    @Test
    @DisplayName("Cuenta de Google sin usuario: UsuarioNoRegistradoException (sale 401 USUARIO_NO_REGISTRADO)")
    void cuentaSinUsuario() {
        when(validador.validarIdentidad(TOKEN))
                .thenReturn(new IdentidadExterna("uid-x", "nueva@gmail.com", true, null));

        assertThrows(UsuarioNoRegistradoException.class, () -> resolutor.resolver(TOKEN));
    }

    @Test
    @DisplayName("Token que no verifica: el error del validador se propaga como credenciales inválidas")
    void tokenInvalido() {
        when(validador.validarIdentidad(TOKEN)).thenThrow(new CredencialesInvalidasException("firma"));

        assertThrows(CredencialesInvalidasException.class, () -> resolutor.resolver(TOKEN));
    }
}
