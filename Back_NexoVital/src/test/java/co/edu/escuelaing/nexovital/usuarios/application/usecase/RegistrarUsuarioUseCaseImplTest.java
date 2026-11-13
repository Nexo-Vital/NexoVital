package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.DatosRegistroInvalidosException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.RolNoElegibleException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioYaRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.DatosRegistro;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UnidadConductorPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Reglas del registro con Google (EP-06.F2.US1, T10/T12), sin base de datos:
 * qué roles se pueden elegir, qué se exige al conductor y de dónde salen el
 * nombre y el correo.
 */
class RegistrarUsuarioUseCaseImplTest {

    private static final IdentidadExterna GOOGLE =
            new IdentidadExterna("uid-1", "Persona@Gmail.com", true, "Persona Prueba");

    private UsuarioRepository usuarios;
    private UnidadConductorPort unidades;
    private RegistrarUsuarioUseCaseImpl casoDeUso;

    @BeforeEach
    void preparar() {
        usuarios = mock(UsuarioRepository.class);
        unidades = mock(UnidadConductorPort.class);
        PasswordEncoderPort encoder = mock(PasswordEncoderPort.class);
        when(encoder.encriptar(anyString())).thenReturn("hash-aleatorio");
        when(usuarios.buscarPorFirebaseUid(anyString())).thenReturn(Optional.empty());
        when(usuarios.guardarEnlazado(any(Usuario.class), anyString()))
                .thenAnswer(invocacion -> invocacion.getArgument(0));
        casoDeUso = new RegistrarUsuarioUseCaseImpl(usuarios, encoder, unidades);
    }

    @Test
    @DisplayName("Ciudadano: toma nombre y correo del token y enlaza el uid de Google")
    void registraCiudadanoConLosDatosDelToken() {
        Usuario creado = casoDeUso.registrar(GOOGLE, new DatosRegistro(RolUsuario.CIUDADANO, null, null));

        assertEquals("Persona Prueba", creado.getNombre());
        assertEquals("persona@gmail.com", creado.getEmail(), "el correo se guarda en minúsculas");
        assertEquals(RolUsuario.CIUDADANO, creado.getRol());
        verify(usuarios).guardarEnlazado(any(Usuario.class), eq("uid-1"));
        verifyNoInteractions(unidades);
    }

    @Test
    @DisplayName("Sin nombre en el token, usa la parte del correo antes de la arroba")
    void sinNombreUsaElCorreo() {
        IdentidadExterna sinNombre = new IdentidadExterna("uid-2", "maria@gmail.com", true, null);

        Usuario creado = casoDeUso.registrar(sinNombre, new DatosRegistro(RolUsuario.CIUDADANO, null, null));

        assertEquals("maria", creado.getNombre());
    }

    @Test
    @DisplayName("La contraseña local es un hash aleatorio: el usuario solo entra por el IdP")
    void laContrasenaLocalNoEsConocida() {
        Usuario creado = casoDeUso.registrar(GOOGLE, new DatosRegistro(RolUsuario.ADMIN_CENTRO_AYUDA, null, null));

        assertEquals("hash-aleatorio", creado.getPasswordHash());
    }

    @ParameterizedTest
    @EnumSource(value = RolUsuario.class, names = {"ADMIN_PLATAFORMA", "ADMIN_ACOPIO"})
    @DisplayName("Los roles de administración no se pueden elegir")
    void rechazaRolesNoElegibles(RolUsuario rol) {
        DatosRegistro datos = new DatosRegistro(rol, null, null);

        assertThrows(RolNoElegibleException.class, () -> casoDeUso.registrar(GOOGLE, datos));
        verify(usuarios, never()).guardarEnlazado(any(), anyString());
    }

    @Test
    @DisplayName("Sin rol: datos inválidos")
    void exigeRol() {
        DatosRegistro datos = new DatosRegistro(null, null, null);

        assertThrows(DatosRegistroInvalidosException.class, () -> casoDeUso.registrar(GOOGLE, datos));
    }

    @Test
    @DisplayName("Conductor: normaliza la placa y crea su vehículo con el modelo")
    void registraConductorConSuVehiculo() {
        Usuario creado = casoDeUso.registrar(GOOGLE,
                new DatosRegistro(RolUsuario.CONDUCTOR, " xyz-789 ", "  Renault   Master  "));

        verify(unidades).registrarUnidad(creado.getId(), "XYZ789", "Renault Master");
    }

    @Test
    @DisplayName("Conductor sin placa, con placa mal formada o sin modelo: no se crea nada")
    void conductorConDatosIncompletos() {
        assertThrows(DatosRegistroInvalidosException.class, () -> casoDeUso.registrar(GOOGLE,
                new DatosRegistro(RolUsuario.CONDUCTOR, null, "Renault")));
        assertThrows(DatosRegistroInvalidosException.class, () -> casoDeUso.registrar(GOOGLE,
                new DatosRegistro(RolUsuario.CONDUCTOR, "AB12", "Renault")));
        assertThrows(DatosRegistroInvalidosException.class, () -> casoDeUso.registrar(GOOGLE,
                new DatosRegistro(RolUsuario.CONDUCTOR, "ABC123", "   ")));

        verify(usuarios, never()).guardarEnlazado(any(), anyString());
        verifyNoInteractions(unidades);
    }

    @Test
    @DisplayName("La misma cuenta de Google o el mismo correo no se registran dos veces")
    void rechazaCuentaYaRegistrada() {
        Usuario existente = new Usuario(UUID.randomUUID(), "Ya", "persona@gmail.com", "h", RolUsuario.CIUDADANO);
        when(usuarios.buscarPorFirebaseUid("uid-1")).thenReturn(Optional.of(existente));
        DatosRegistro datos = new DatosRegistro(RolUsuario.CIUDADANO, null, null);

        assertThrows(UsuarioYaRegistradoException.class, () -> casoDeUso.registrar(GOOGLE, datos));

        when(usuarios.buscarPorFirebaseUid("uid-1")).thenReturn(Optional.empty());
        when(usuarios.existePorEmail("persona@gmail.com")).thenReturn(true);
        assertThrows(UsuarioYaRegistradoException.class, () -> casoDeUso.registrar(GOOGLE, datos));
    }

    @Test
    @DisplayName("Cada registro crea un usuario nuevo con id propio")
    void idNuevoEnCadaRegistro() {
        ArgumentCaptor<Usuario> captor = ArgumentCaptor.forClass(Usuario.class);
        casoDeUso.registrar(GOOGLE, new DatosRegistro(RolUsuario.CIUDADANO, null, null));
        casoDeUso.registrar(new IdentidadExterna("uid-9", "otra@gmail.com", true, "Otra"),
                new DatosRegistro(RolUsuario.CIUDADANO, null, null));

        verify(usuarios, org.mockito.Mockito.times(2)).guardarEnlazado(captor.capture(), anyString());
        assertNotEquals(captor.getAllValues().get(0).getId(), captor.getAllValues().get(1).getId());
    }
}
