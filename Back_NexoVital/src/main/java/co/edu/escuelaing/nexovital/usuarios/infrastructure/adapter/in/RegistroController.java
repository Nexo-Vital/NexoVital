package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.infrastructure.config.RegistroAccesoDenegado;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.DatosRegistroInvalidosException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.PlacaDuplicadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.RolNoElegibleException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioYaRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.DatosRegistro;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.RegistrarUsuarioUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.VerificadorIdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.RegistroRequest;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.UsuarioDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;

/**
 * Registro de una cuenta nueva que entra con Google (EP-06.F2.US1, T10). El
 * recurso es {@code registros}: crear uno es {@code POST /api/v1/registros}.
 *
 * <p>La cadena de seguridad lo deja pasar porque quien se registra todavía no
 * tiene usuario, pero este controlador exige un token válido de Google en
 * {@code Authorization: Bearer}. Sin él responde 401 y lo registra, igual que
 * el resto de la API (escenario S-1).
 *
 * <p>Respuestas:
 * <ul>
 *   <li>201 con el usuario creado.</li>
 *   <li>400 {@code DATOS_INVALIDOS}: rol desconocido, o conductor sin placa o modelo válidos.</li>
 *   <li>401 {@code NO_AUTENTICADO}: sin token de Google o token que no verifica.</li>
 *   <li>403 {@code ROL_NO_ELEGIBLE}: se pidió administrador de plataforma o de acopio.</li>
 *   <li>404: el IdP externo no está configurado (desarrollo con login local).</li>
 *   <li>409 {@code USUARIO_YA_REGISTRADO} o {@code PLACA_DUPLICADA}.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/registros")
@Tag(name = "usuarios")
public class RegistroController {

    private static final String PREFIJO_BEARER = "Bearer ";

    private final RegistrarUsuarioUseCase registrarUsuarioUseCase;
    private final ObjectProvider<VerificadorIdentidadExterna> verificador;
    private final RegistroAccesoDenegado registroAccesoDenegado;

    public RegistroController(RegistrarUsuarioUseCase registrarUsuarioUseCase,
                              ObjectProvider<VerificadorIdentidadExterna> verificador,
                              RegistroAccesoDenegado registroAccesoDenegado) {
        this.registrarUsuarioUseCase = registrarUsuarioUseCase;
        this.verificador = verificador;
        this.registroAccesoDenegado = registroAccesoDenegado;
    }

    @PostMapping
    @Operation(summary = "Registrar la cuenta de Google con el rol elegido")
    public ResponseEntity<Object> registrar(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestBody(required = false) RegistroRequest request,
            HttpServletRequest httpRequest) {

        VerificadorIdentidadExterna idp = verificador.getIfAvailable();
        if (idp == null) {
            // Sin IdP externo no hay registro: el producto solo registra con Google.
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("REGISTRO_NO_DISPONIBLE", "El registro requiere el inicio de sesión con Google"));
        }

        if (authorization == null || !authorization.startsWith(PREFIJO_BEARER)) {
            registroAccesoDenegado.registrarNoAutenticado(httpRequest, "token_ausente");
            return noAutenticado();
        }
        IdentidadExterna identidad;
        try {
            identidad = idp.verificar(authorization.substring(PREFIJO_BEARER.length()));
        } catch (CredencialesInvalidasException e) {
            registroAccesoDenegado.registrarNoAutenticado(httpRequest, "token_invalido");
            return noAutenticado();
        }

        if (request == null || request.rol() == null || request.rol().isBlank()) {
            return error(HttpStatus.BAD_REQUEST, "DATOS_INVALIDOS", "Debes elegir un rol.");
        }
        RolUsuario rol;
        try {
            rol = RolUsuario.valueOf(request.rol().trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return error(HttpStatus.BAD_REQUEST, "DATOS_INVALIDOS", "El rol " + request.rol() + " no existe.");
        }

        try {
            Usuario usuario = registrarUsuarioUseCase.registrar(
                    identidad, new DatosRegistro(rol, request.placa(), request.modelo()));
            return ResponseEntity.status(HttpStatus.CREATED).body(UsuarioDto.fromDomain(usuario));
        } catch (RolNoElegibleException e) {
            // Pedir un rol de administracion es un intento de escalar privilegios:
            // queda en la misma bitacora que los demas 403 (S-1 / T11).
            registroAccesoDenegado.registrarIdentidadExterna(identidad.uid(), "rol_no_elegible");
            return error(HttpStatus.FORBIDDEN, "ROL_NO_ELEGIBLE", e.getMessage());
        } catch (DatosRegistroInvalidosException e) {
            return error(HttpStatus.BAD_REQUEST, "DATOS_INVALIDOS", e.getMessage());
        } catch (UsuarioYaRegistradoException e) {
            return error(HttpStatus.CONFLICT, "USUARIO_YA_REGISTRADO", e.getMessage());
        } catch (PlacaDuplicadaException e) {
            return error(HttpStatus.CONFLICT, "PLACA_DUPLICADA", e.getMessage());
        } catch (DataIntegrityViolationException e) {
            // Dos registros simultaneos de la misma cuenta: la restriccion unica de
            // correo o de uid deja pasar solo a uno.
            return error(HttpStatus.CONFLICT, "USUARIO_YA_REGISTRADO", "Esta cuenta ya está registrada. Inicia sesión.");
        }
    }

    private static ResponseEntity<Object> noAutenticado() {
        return error(HttpStatus.UNAUTHORIZED, "NO_AUTENTICADO", "Token ausente, inválido o expirado");
    }

    private static ResponseEntity<Object> error(HttpStatus status, String codigo, String mensaje) {
        return ResponseEntity.status(status).body(ErrorResponse.of(codigo, mensaje));
    }
}
