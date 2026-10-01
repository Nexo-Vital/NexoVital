package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaAjenaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConsultarFlotaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ListarSolicitudesDeMiAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AmbulanciaDto;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.ReportarPosicionRequest;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Inbound adapter of the fleet read model: {@code GET
 * /api/v1/flota/ambulancias}, the path the OpenAPI contract fixes (AC5), and the
 * server-scoped {@code GET /api/v1/flota/ambulancias/mia} a driver uses to find
 * its OWN unit.
 *
 * <p>Error handling lives here, inside {@code flota}, with {@code try/catch}
 * and the {@code ErrorResponse} envelope: this repository has no
 * {@code @ControllerAdvice}. An empty array is a valid 200.
 */
@RestController
@RequestMapping("/api/v1/flota")
@Tag(name = "flota")
public class FlotaController {

    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar la flota.";
    private static final String MENSAJE_ERROR_CONSULTA_PROPIA =
            "No fue posible consultar tu ambulancia.";
    private static final String MENSAJE_ERROR_CONSULTA_HISTORIAL =
            "No fue posible consultar el historial de tu ambulancia.";
    private static final String MENSAJE_DATOS_POSICION =
            "El reporte de posición no es válido: indique la ubicación.";
    private static final String MENSAJE_AMBULANCIA_AJENA =
            "La ambulancia indicada no pertenece al conductor autenticado.";
    private static final String MENSAJE_AMBULANCIA_NO_DISPONIBLE =
            "La ambulancia indicada no existe.";
    private static final String MENSAJE_ERROR_POSICION = "No fue posible reportar la posición.";

    private final ConsultarFlotaUseCase consultarFlotaUseCase;
    private final ListarSolicitudesDeMiAmbulanciaUseCase listarSolicitudesDeMiAmbulanciaUseCase;
    private final ReportarPosicionUseCase reportarPosicionUseCase;

    public FlotaController(ConsultarFlotaUseCase consultarFlotaUseCase,
                           ListarSolicitudesDeMiAmbulanciaUseCase listarSolicitudesDeMiAmbulanciaUseCase,
                           ReportarPosicionUseCase reportarPosicionUseCase) {
        this.consultarFlotaUseCase = consultarFlotaUseCase;
        this.listarSolicitudesDeMiAmbulanciaUseCase = listarSolicitudesDeMiAmbulanciaUseCase;
        this.reportarPosicionUseCase = reportarPosicionUseCase;
    }

    /**
     * @return 200 with the {@code AmbulanciaDto} array (position and state);
     *         500 {@code ERROR_CONSULTA_FLOTA} if the query fails
     */
    @GetMapping("/ambulancias")
    @Operation(summary = "Flota en vivo (estado y posicion de cada ambulancia)")
    public ResponseEntity<Object> ambulancias() {
        try {
            List<AmbulanciaDto> flota = consultarFlotaUseCase.consultarFlota().stream()
                    .map(AmbulanciaDto::fromDomain)
                    .toList();
            return ResponseEntity.ok(flota);
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_FLOTA", MENSAJE_ERROR_CONSULTA));
        }
    }

    /**
     * The authenticated driver's OWN unit. It is the minimal server-scoped read
     * that replaces resolving the unit from the general fleet list, which no
     * longer exposes any driver id.
     *
     * @return 200 with the caller's {@code AmbulanciaDto}, or 200 with JSON
     *         {@code null} when the caller drives no unit (not an error);
     *         500 {@code ERROR_CONSULTA_FLOTA} if the query fails
     */
    @GetMapping("/ambulancias/mia")
    @Operation(summary = "Ambulancia del conductor autenticado")
    public ResponseEntity<Object> miAmbulancia() {
        try {
            UUID conductorId = usuarioAutenticadoId();
            Optional<Ambulancia> propia = consultarFlotaUseCase.consultarPropia(conductorId);
            return ResponseEntity.ok(propia.map(AmbulanciaDto::fromDomain).orElse(null));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_FLOTA", MENSAJE_ERROR_CONSULTA_PROPIA));
        }
    }

    /**
     * The services of the authenticated driver's OWN unit: the requests that
     * were actually ASSIGNED to it (ASIGNADA / CONFIRMADA / TOMADA). A request
     * that was only broadcast is not history, so PENDIENTE / TIMEOUT / CANCELADA
     * never appear. The unit is resolved exactly as {@code /ambulancias/mia}; a
     * driver with no unit mirrors that read (200 with JSON {@code null}).
     *
     * @return 200 with the {@code SolicitudAmbulanciaDto} array, newest first, or
     *         200 with JSON {@code null} when the caller drives no unit; 500
     *         {@code ERROR_CONSULTA_HISTORIAL} if the query fails
     */
    @GetMapping("/ambulancias/mia/solicitudes")
    @Operation(summary = "Historial de servicios de la ambulancia del conductor autenticado")
    public ResponseEntity<Object> misSolicitudes() {
        try {
            UUID conductorId = usuarioAutenticadoId();
            Optional<Ambulancia> propia = consultarFlotaUseCase.consultarPropia(conductorId);
            if (propia.isEmpty()) {
                return ResponseEntity.ok((Object) null);
            }
            List<SolicitudAmbulanciaDto> historial =
                    listarSolicitudesDeMiAmbulanciaUseCase.listar(propia.get().getId()).stream()
                            .map(SolicitudAmbulanciaDto::fromDomain)
                            .toList();
            return ResponseEntity.ok(historial);
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_HISTORIAL", MENSAJE_ERROR_CONSULTA_HISTORIAL));
        }
    }

    /**
     * A driver reports the live position of its OWN unit (EP-04.F1.US1, D-T1:
     * REST, never STOMP — this backend has no {@code @MessageMapping}). It
     * reuses the accept/reject/arrival actor check: the unit must belong to the
     * authenticated driver, so a driver cannot move another unit. The position
     * is propagated to {@code /topic/flota} AFTER commit (D-T3).
     *
     * @return 200 with the updated {@code AmbulanciaDto}; 409
     *         {@code AMBULANCIA_AJENA} if the unit is not the caller's; 409
     *         {@code AMBULANCIA_NO_DISPONIBLE} if the unit does not exist; 400
     *         {@code DATOS_INVALIDOS} on a missing location; 500
     *         {@code ERROR_REPORTE_POSICION} if persistence fails
     */
    @PostMapping("/ambulancias/{id}/posicion")
    @Operation(summary = "Reportar la posicion de la propia unidad")
    public ResponseEntity<Object> reportarPosicion(@PathVariable UUID id,
                                                   @RequestBody ReportarPosicionRequest request) {
        try {
            if (request == null || request.ubicacion() == null) {
                throw new IllegalArgumentException("La ubicación es obligatoria.");
            }
            // The route always speaks for a device; the client cannot pick the
            // source, so it can never pretend to be the simulator.
            Ambulancia actualizada = reportarPosicionUseCase.reportarPosicion(
                    id, usuarioAutenticadoId(),
                    request.ubicacion().lat(), request.ubicacion().lng(),
                    request.heading(), FuentePosicion.DEVICE);
            return ResponseEntity.ok(AmbulanciaDto.fromDomain(actualizada));
        } catch (AmbulanciaAjenaException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("AMBULANCIA_AJENA", MENSAJE_AMBULANCIA_AJENA));
        } catch (AmbulanciaNoDisponibleException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("AMBULANCIA_NO_DISPONIBLE", MENSAJE_AMBULANCIA_NO_DISPONIBLE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_POSICION));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_REPORTE_POSICION", MENSAJE_ERROR_POSICION));
        }
    }

    /** The authenticated principal is the {@code Usuario} set by the JWT filter. */
    private UUID usuarioAutenticadoId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return usuario.getId();
    }
}
