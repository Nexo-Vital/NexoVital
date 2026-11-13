package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.DatosRegistroInvalidosException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.RolNoElegibleException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioYaRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.DatosRegistro;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.RegistrarUsuarioUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UnidadConductorPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Registro con Google y elección de rol (EP-06.F2.US1, T10).
 *
 * <p>Reglas (docs/matriz-permisos.md, sección 4):
 * <ul>
 *   <li>Solo se eligen ciudadano, administrador de centro y conductor. Los
 *       administradores de plataforma y de acopio nunca se autoasignan.</li>
 *   <li>El nombre y el correo salen del token de Google, no del cliente.</li>
 *   <li>El conductor indica placa y modelo; la placa es única.</li>
 * </ul>
 *
 * <p>Todo ocurre en una sola transacción: si la placa está repetida, el usuario
 * tampoco queda creado y la persona puede intentarlo de nuevo con otra placa.
 *
 * <p>La contraseña local se llena con un hash de un valor aleatorio que nadie
 * conoce: el usuario existe solo por Google y el login local no le sirve.
 */
@Service
public class RegistrarUsuarioUseCaseImpl implements RegistrarUsuarioUseCase {

    /** Roles que una persona puede elegir para sí misma. */
    static final Set<RolUsuario> ROLES_ELEGIBLES =
            Set.of(RolUsuario.CIUDADANO, RolUsuario.ADMIN_CENTRO_AYUDA, RolUsuario.CONDUCTOR);

    /** Placa de vehículo particular o de servicio en Colombia: tres letras y tres números (ABC123). */
    private static final Pattern PLACA = Pattern.compile("^[A-Z]{3}\\d{3}$");

    private static final int LARGO_MAXIMO_MODELO = 60;
    private static final int LARGO_MAXIMO_NOMBRE = 120;

    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoderPort passwordEncoderPort;
    private final UnidadConductorPort unidadConductorPort;

    public RegistrarUsuarioUseCaseImpl(UsuarioRepository usuarioRepository,
                                       PasswordEncoderPort passwordEncoderPort,
                                       UnidadConductorPort unidadConductorPort) {
        this.usuarioRepository = usuarioRepository;
        this.passwordEncoderPort = passwordEncoderPort;
        this.unidadConductorPort = unidadConductorPort;
    }

    @Override
    @Transactional
    public Usuario registrar(IdentidadExterna identidad, DatosRegistro datos) {
        if (datos.rol() == null) {
            throw new DatosRegistroInvalidosException("Debes elegir un rol.");
        }
        if (!ROLES_ELEGIBLES.contains(datos.rol())) {
            throw new RolNoElegibleException(datos.rol());
        }
        String email = identidad.email() == null ? "" : identidad.email().trim().toLowerCase(Locale.ROOT);
        if (email.isEmpty()) {
            throw new DatosRegistroInvalidosException("La cuenta de Google no compartió un correo.");
        }

        String placa = null;
        String modelo = null;
        if (datos.rol() == RolUsuario.CONDUCTOR) {
            placa = normalizarPlaca(datos.placa());
            modelo = normalizarModelo(datos.modelo());
        }

        if (usuarioRepository.buscarPorFirebaseUid(identidad.uid()).isPresent()
                || usuarioRepository.existePorEmail(email)) {
            throw new UsuarioYaRegistradoException();
        }

        Usuario nuevo = new Usuario(
                UUID.randomUUID(),
                nombreVisible(identidad.nombre(), email),
                email,
                passwordEncoderPort.encriptar(UUID.randomUUID().toString()),
                datos.rol());
        Usuario guardado = usuarioRepository.guardarEnlazado(nuevo, identidad.uid());

        if (datos.rol() == RolUsuario.CONDUCTOR) {
            unidadConductorPort.registrarUnidad(guardado.getId(), placa, modelo);
        }
        return guardado;
    }

    /** Mayúsculas y sin espacios ni guiones: "abc-123" y "ABC 123" son la misma placa. */
    static String normalizarPlaca(String placa) {
        String normalizada = placa == null ? "" : placa.replaceAll("[\\s-]", "").toUpperCase(Locale.ROOT);
        if (normalizada.isEmpty()) {
            throw new DatosRegistroInvalidosException("La placa del vehículo es obligatoria para el conductor.");
        }
        if (!PLACA.matcher(normalizada).matches()) {
            throw new DatosRegistroInvalidosException("La placa debe tener tres letras y tres números, por ejemplo ABC123.");
        }
        return normalizada;
    }

    static String normalizarModelo(String modelo) {
        String limpio = modelo == null ? "" : modelo.trim().replaceAll("\\s+", " ");
        if (limpio.isEmpty()) {
            throw new DatosRegistroInvalidosException("El modelo del vehículo es obligatorio para el conductor.");
        }
        if (limpio.length() > LARGO_MAXIMO_MODELO) {
            throw new DatosRegistroInvalidosException(
                    "El modelo del vehículo admite máximo " + LARGO_MAXIMO_MODELO + " caracteres.");
        }
        return limpio;
    }

    /** El nombre de la cuenta de Google o, si no lo trae, la parte del correo antes de la arroba. */
    private static String nombreVisible(String nombre, String email) {
        String base;
        if (nombre != null && !nombre.isBlank()) {
            base = nombre.trim();
        } else {
            int arroba = email.indexOf('@');
            base = arroba > 0 ? email.substring(0, arroba) : email;
        }
        return base.length() > LARGO_MAXIMO_NOMBRE ? base.substring(0, LARGO_MAXIMO_NOMBRE) : base;
    }
}
