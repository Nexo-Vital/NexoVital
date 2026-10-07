package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudEnCursoException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DeclararDisponibilidadUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.GestionarConexionUnidadUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ListarSolicitudesPendientesDeMiAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AmbulanciaDto;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.DisponibilidadRequest;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.SolicitudAmbulanciaDto;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Inbound adapter of the driver's connection to the service (EP-04.F2.US1, D3
 * and D6): connect, disconnect, declare the unit available or out of service,
 * and read the open requests the driver can still answer.
 *
 * <p>The four routes hang from {@code /api/v1/flota/ambulancias/mia}: the unit
 * is always resolved from the authenticated driver, exactly as
 * {@code GET .../mia} does, so the client never sends a unit id it could forge.
 * A driver with no unit mirrors that read: 200 with JSON {@code null}.
 *
 * <p>Error handling lives here, with {@code try/catch} and the
 * {@code ErrorResponse} envelope, like the rest of {@code flota}.
 */
@RestController
@RequestMapping("/api/v1/flota")
@Tag(name = "flota")
public class ConexionFlotaController {

    private static final String MENSAJE_SOLICITUD_EN_CURSO =
            "Finaliza el servicio en curso para poder desconectarte.";
    private static final String MENSAJE_ERROR_CONEXION =
            "No fue posible cambiar la conexión de tu ambulancia.";
    private static final String MENSAJE_ERROR_PENDIENTES =
            "No fue posible consultar las solicitudes pendientes de tu ambulancia.";
    private static final String MENSAJE_SERVICIO_EN_CURSO =
            "Finaliza el servicio en curso para poder cambiar tu estado.";
    private static final String MENSAJE_DATOS_DISPONIBILIDAD =
            "Indique si la ambulancia queda disponible o fuera de servicio.";
    private static final String MENSAJE_ERROR_DISPONIBILIDAD =
            "No fue posible cambiar el estado de tu ambulancia.";

    private final GestionarConexionUnidadUseCase gestionarConexionUnidadUseCase;
    private final ListarSolicitudesPendientesDeMiAmbulanciaUseCase listarPendientesUseCase;
    private final DeclararDisponibilidadUseCase declararDisponibilidadUseCase;

    public ConexionFlotaController(GestionarConexionUnidadUseCase gestionarConexionUnidadUseCase,
                                   ListarSolicitudesPendientesDeMiAmbulanciaUseCase listarPendientesUseCase,
                                   DeclararDisponibilidadUseCase declararDisponibilidadUseCase) {
        this.gestionarConexionUnidadUseCase = gestionarConexionUnidadUseCase;
        this.listarPendientesUseCase = listarPendientesUseCase;
        this.declararDisponibilidadUseCase = declararDisponibilidadUseCase;
    }

    /**
     * Connects the caller's unit: from now on it receives new requests while it
     * is available and has signal. Repeatable.
     *
     * @return 200 with the caller's {@code AmbulanciaDto}, or 200 with JSON
     *         {@code null} when the caller drives no unit; 500
     *         {@code ERROR_CONEXION_FLOTA} if persistence fails
     */
    @PostMapping("/ambulancias/mia/conectar")
    @Operation(summary = "Conectar la ambulancia del conductor autenticado")
    public ResponseEntity<Object> conectar() {
        try {
            Optional<Ambulancia> unidad = gestionarConexionUnidadUseCase.conectar(usuarioAutenticadoId());
            return ResponseEntity.ok(unidad.map(AmbulanciaDto::fromDomain).orElse(null));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONEXION_FLOTA", MENSAJE_ERROR_CONEXION));
        }
    }

    /**
     * Disconnects the caller's unit: it stops receiving new requests. A unit
     * that is attending a request cannot be disconnected. Repeatable.
     *
     * @return 200 with the caller's {@code AmbulanciaDto}, or 200 with JSON
     *         {@code null} when the caller drives no unit; 409
     *         {@code SOLICITUD_EN_CURSO} if the unit is attending a request; 500
     *         {@code ERROR_CONEXION_FLOTA} if persistence fails
     */
    @PostMapping("/ambulancias/mia/desconectar")
    @Operation(summary = "Desconectar la ambulancia del conductor autenticado")
    public ResponseEntity<Object> desconectar() {
        try {
            Optional<Ambulancia> unidad = gestionarConexionUnidadUseCase.desconectar(usuarioAutenticadoId());
            return ResponseEntity.ok(unidad.map(AmbulanciaDto::fromDomain).orElse(null));
        } catch (SolicitudEnCursoException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_EN_CURSO", MENSAJE_SOLICITUD_EN_CURSO));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONEXION_FLOTA", MENSAJE_ERROR_CONEXION));
        }
    }

    /**
     * The driver declares their unit available or out of service ("Disponible"
     * / "Fuera de servicio"). Only an available unit receives a new request. A
     * unit that is attending a request cannot change it. Repeatable.
     *
     * @return 200 with the caller's {@code AmbulanciaDto}, or 200 with JSON
     *         {@code null} when the caller drives no unit; 409
     *         {@code SOLICITUD_EN_CURSO} if the unit is attending a request; 400
     *         {@code DATOS_INVALIDOS} when {@code disponible} is missing; 500
     *         {@code ERROR_DISPONIBILIDAD_FLOTA} if persistence fails
     */
    @PostMapping("/ambulancias/mia/disponibilidad")
    @Operation(summary = "Declarar la ambulancia del conductor disponible o fuera de servicio")
    public ResponseEntity<Object> declararDisponibilidad(@RequestBody DisponibilidadRequest request) {
        try {
            if (request == null || request.disponible() == null) {
                throw new IllegalArgumentException("El campo disponible es obligatorio.");
            }
            Optional<Ambulancia> unidad = declararDisponibilidadUseCase.declarar(
                    usuarioAutenticadoId(), request.disponible());
            return ResponseEntity.ok(unidad.map(AmbulanciaDto::fromDomain).orElse(null));
        } catch (SolicitudEnCursoException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_EN_CURSO", MENSAJE_SERVICIO_EN_CURSO));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_DISPONIBILIDAD));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_DISPONIBILIDAD_FLOTA", MENSAJE_ERROR_DISPONIBILIDAD));
        }
    }

    /**
     * The open requests the caller can still answer: PENDING, with the accept
     * window still open, and notified to the caller's unit. Empty while the unit
     * is disconnected or not available.
     *
     * @return 200 with the {@code SolicitudAmbulanciaDto} array, oldest first, or
     *         200 with JSON {@code null} when the caller drives no unit; 500
     *         {@code ERROR_CONSULTA_PENDIENTES} if the query fails
     */
    @GetMapping("/ambulancias/mia/solicitudes/pendientes")
    @Operation(summary = "Solicitudes pendientes que la ambulancia del conductor aun puede responder")
    public ResponseEntity<Object> misSolicitudesPendientes() {
        try {
            Optional<List<SolicitudAmbulancia>> pendientes =
                    listarPendientesUseCase.listar(usuarioAutenticadoId());
            if (pendientes.isEmpty()) {
                return ResponseEntity.ok((Object) null);
            }
            List<SolicitudAmbulanciaDto> cuerpo = pendientes.get().stream()
                    .map(SolicitudAmbulanciaDto::fromDomain)
                    .toList();
            return ResponseEntity.ok(cuerpo);
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_PENDIENTES", MENSAJE_ERROR_PENDIENTES));
        }
    }

    /** The authenticated principal is the {@code Usuario} set by the JWT filter. */
    private UUID usuarioAutenticadoId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return usuario.getId();
    }
}
