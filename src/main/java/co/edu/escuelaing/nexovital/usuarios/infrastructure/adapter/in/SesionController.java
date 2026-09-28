package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CuentaBloqueadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.CredencialesLogin;
import co.edu.escuelaing.nexovital.usuarios.domain.model.SesionAuth;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.AuthenticationUseCase;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.SesionRequest;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.SesionResponse;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.UsuarioDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Adaptador de entrada de sesiones. El recurso es {@code sesiones} (sustantivo
 * plural): crear una sesión es {@code POST /api/v1/sesiones} y consultar la
 * sesión vigente es {@code GET /api/v1/sesiones/actual}.
 *
 * <p>El manejo de errores de autenticación vive aquí, dentro del módulo
 * {@code usuarios} (diseño D7), no en un advice transversal.
 */
@RestController
@RequestMapping("/api/v1/sesiones")
@Tag(name = "usuarios")
public class SesionController {

    /**
     * Mensaje único para email inexistente y contraseña incorrecta: el cliente
     * no debe poder distinguir si la cuenta existe (diseño D5).
     */
    private static final String MENSAJE_CREDENCIALES_INVALIDAS = "Credenciales inválidas.";

    private final AuthenticationUseCase authenticationUseCase;

    public SesionController(AuthenticationUseCase authenticationUseCase) {
        this.authenticationUseCase = authenticationUseCase;
    }

    /**
     * Crea una sesión. El contrato fija {@code 200 OK} en el éxito.
     *
     * @return 200 con {@code {token, usuario}}; 401 {@code CREDENCIALES_INVALIDAS};
     *         423 {@code CUENTA_BLOQUEADA} con cabecera {@code Retry-After}
     */
    @PostMapping
    @Operation(summary = "Crear una sesion (autenticacion por email y contrasena)")
    @SecurityRequirements
    public ResponseEntity<Object> crearSesion(@Valid @RequestBody SesionRequest request) {
        try {
            SesionAuth sesion = authenticationUseCase.login(
                    new CredencialesLogin(request.email(), request.password()));
            return ResponseEntity.ok(new SesionResponse(sesion.token(), UsuarioDto.fromDomain(sesion.usuario())));
        } catch (CuentaBloqueadaException e) {
            return ResponseEntity.status(HttpStatus.LOCKED)
                    .header(HttpHeaders.RETRY_AFTER, Long.toString(e.getSegundosRestantes()))
                    .body(ErrorResponse.of("CUENTA_BLOQUEADA", e.getMessage()));
        } catch (UsuarioNoEncontradoException | CredencialesInvalidasException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(ErrorResponse.of("CREDENCIALES_INVALIDAS", MENSAJE_CREDENCIALES_INVALIDAS));
        }
    }

    /**
     * Devuelve el usuario de la sesión vigente, resuelto por {@code JwtAuthFilter}
     * a partir del Bearer token. Sin token válido la petición no llega aquí:
     * Spring Security responde 401.
     */
    @GetMapping("/actual")
    @Operation(summary = "Sesion del llamante")
    public UsuarioDto sesionActual(Authentication authentication) {
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return UsuarioDto.fromDomain(usuario);
    }
}
