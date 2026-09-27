package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DeclararLlegadaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.RechazarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AceptarSolicitudRequest;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AceptarSolicitudResponse;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.RechazarSolicitudRequest;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.SolicitudAmbulanciaDto;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.SolicitudRequest;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * HTTP adapter of the C2 broadcast request (EP-04). Pure HTTP-to-domain
 * translation: no business logic. A lost accept CAS answers 409
 * {@code CAS_PERDIDO} and the driver pop-up shows the request as already
 * assigned.
 *
 * <p>Error handling lives here, inside {@code flota}, with {@code try/catch}
 * and the {@code ErrorResponse} envelope: this repository has no
 * {@code @ControllerAdvice}. The {@code catch} order matters: the not-found
 * (404) falls before the conflict (409), and this before the generic (500).
 */
@RestController
@RequestMapping("/api/v1/solicitudes")
public class SolicitudController {

    private static final String MENSAJE_DATOS_INVALIDOS =
            "La solicitud no es válida: revise la emergencia, el centro y la zona.";
    private static final String MENSAJE_DATOS_ACEPTACION = "El accept no es válido: indique la ambulancia.";
    private static final String MENSAJE_DATOS_RECHAZO = "El reject no es válido: indique la ambulancia.";
    private static final String MENSAJE_DATOS_LLEGADA = "La llegada no es válida: indique la ambulancia.";
    private static final String MENSAJE_SOLICITUD_NO_ENCONTRADA =
            "No existe una solicitud con el identificador indicado.";
    private static final String MENSAJE_SOLICITUD_NO_ASIGNABLE =
            "La solicitud ya no admite esa transición.";
    private static final String MENSAJE_CAS_PERDIDO = "Solicitud ya asignada a otra ambulancia.";
    private static final String MENSAJE_AMBULANCIA_NO_DISPONIBLE =
            "No hay ambulancias disponibles para atender la solicitud.";
    private static final String MENSAJE_ERROR_SOLICITUD = "No fue posible registrar la solicitud.";
    private static final String MENSAJE_ERROR_ACEPTACION = "No fue posible aceptar la solicitud.";
    private static final String MENSAJE_ERROR_RECHAZO = "No fue posible rechazar la solicitud.";
    private static final String MENSAJE_ERROR_LLEGADA = "No fue posible declarar la llegada.";
    private static final String MENSAJE_ERROR_CONFIRMACION = "No fue posible confirmar la solicitud.";

    private final SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;
    private final AceptarSolicitudUseCase aceptarSolicitudUseCase;
    private final RechazarSolicitudUseCase rechazarSolicitudUseCase;
    private final DeclararLlegadaUseCase declararLlegadaUseCase;
    private final ConfirmarSolicitudUseCase confirmarSolicitudUseCase;

    public SolicitudController(SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase,
                               AceptarSolicitudUseCase aceptarSolicitudUseCase,
                               RechazarSolicitudUseCase rechazarSolicitudUseCase,
                               DeclararLlegadaUseCase declararLlegadaUseCase,
                               ConfirmarSolicitudUseCase confirmarSolicitudUseCase) {
        this.solicitarAmbulanciaUseCase = solicitarAmbulanciaUseCase;
        this.aceptarSolicitudUseCase = aceptarSolicitudUseCase;
        this.rechazarSolicitudUseCase = rechazarSolicitudUseCase;
        this.declararLlegadaUseCase = declararLlegadaUseCase;
        this.confirmarSolicitudUseCase = confirmarSolicitudUseCase;
    }

    /**
     * Broadcasts the request to every available unit of the zone. The
     * authenticated citizen is persisted as the requester and receives the
     * lifecycle on their own user destination.
     *
     * @return 201 with the created request; 409 {@code AMBULANCIA_NO_DISPONIBLE}
     *         if the zone has none; 400 {@code DATOS_INVALIDOS} on a missing
     *         field; 500 {@code ERROR_REGISTRO_SOLICITUD} if persistence fails
     */
    @PostMapping
    public ResponseEntity<Object> solicitar(@RequestBody SolicitudRequest request) {
        try {
            if (request == null || request.emergenciaId() == null) {
                throw new IllegalArgumentException("La emergencia es obligatoria.");
            }
            if (request.centroAyudaId() == null) {
                throw new IllegalArgumentException("El centro de ayuda es obligatorio.");
            }
            if (request.zonaId() == null || request.zonaId().isBlank()) {
                throw new IllegalArgumentException("La zona es obligatoria.");
            }
            UUID solicitanteId = usuarioAutenticadoId();
            SolicitudAmbulancia creada = solicitarAmbulanciaUseCase.solicitar(
                    request.emergenciaId(), request.centroAyudaId(), request.zonaId(),
                    solicitanteId, request.timeoutEn());
            return ResponseEntity.status(HttpStatus.CREATED).body(SolicitudAmbulanciaDto.fromDomain(creada));
        } catch (AmbulanciaNoDisponibleException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("AMBULANCIA_NO_DISPONIBLE", MENSAJE_AMBULANCIA_NO_DISPONIBLE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_INVALIDOS));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_REGISTRO_SOLICITUD", MENSAJE_ERROR_SOLICITUD));
        }
    }

    /**
     * First accept wins the CAS (AC2). A loser gets 409.
     *
     * @return 200 with {@code ganador=true} and the ASSIGNED request; 409
     *         {@code CAS_PERDIDO} / {@code SOLICITUD_NO_ASIGNABLE} if another
     *         caller won, if the unit was never notified for the request, or if
     *         the unit is not the authenticated driver's; 409
     *         {@code AMBULANCIA_NO_DISPONIBLE} if the unit is already busy; 404
     *         {@code SOLICITUD_NO_ENCONTRADA}; 400 {@code DATOS_INVALIDOS}; 500
     *         {@code ERROR_ACEPTACION_SOLICITUD}
     */
    @PostMapping("/{id}/accept")
    public ResponseEntity<Object> aceptar(@PathVariable UUID id, @RequestBody AceptarSolicitudRequest request) {
        try {
            if (request == null || request.ambulanciaId() == null) {
                throw new IllegalArgumentException("La ambulancia es obligatoria.");
            }
            // The authenticated driver: the use case checks the unit belongs to
            // them before assigning, so the client cannot claim another unit.
            ResultadoAceptarSolicitud resultado =
                    aceptarSolicitudUseCase.aceptar(id, request.ambulanciaId(), usuarioAutenticadoId());
            if (!resultado.ganador()) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body(ErrorResponse.of("CAS_PERDIDO", MENSAJE_CAS_PERDIDO));
            }
            return ResponseEntity.ok(AceptarSolicitudResponse.of(
                    true, SolicitudAmbulanciaDto.fromDomain(resultado.solicitud())));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (SolicitudNoAsignableException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_SOLICITUD_NO_ASIGNABLE));
        } catch (AmbulanciaNoDisponibleException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("AMBULANCIA_NO_DISPONIBLE", MENSAJE_AMBULANCIA_NO_DISPONIBLE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_ACEPTACION));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_ACEPTACION_SOLICITUD", MENSAJE_ERROR_ACEPTACION));
        }
    }

    /**
     * A unit declines. The request stays PENDIENTE for the other notified units
     * (AC4), so a subsequent accept by another unit still succeeds. The unit
     * must belong to the authenticated driver, exactly as accept requires, so a
     * driver cannot decline on behalf of another unit.
     *
     * @return 200 with the still-PENDIENTE request; 404
     *         {@code SOLICITUD_NO_ENCONTRADA}; 409 {@code SOLICITUD_NO_ASIGNABLE}
     *         if it is no longer PENDIENTE, the unit was not notified, or the
     *         unit is not the authenticated driver's; 400
     *         {@code DATOS_INVALIDOS}; 500 {@code ERROR_RECHAZO_SOLICITUD}
     */
    @PostMapping("/{id}/reject")
    public ResponseEntity<Object> rechazar(@PathVariable UUID id, @RequestBody RechazarSolicitudRequest request) {
        try {
            if (request == null || request.ambulanciaId() == null) {
                throw new IllegalArgumentException("La ambulancia es obligatoria.");
            }
            // The authenticated driver: the use case checks the unit belongs to
            // them before declining, so the client cannot reject another unit.
            SolicitudAmbulancia rechazada =
                    rechazarSolicitudUseCase.rechazar(id, request.ambulanciaId(), usuarioAutenticadoId());
            return ResponseEntity.ok(SolicitudAmbulanciaDto.fromDomain(rechazada));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (SolicitudNoAsignableException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_SOLICITUD_NO_ASIGNABLE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_RECHAZO));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_RECHAZO_SOLICITUD", MENSAJE_ERROR_RECHAZO));
        }
    }

    /**
     * The winning unit declares it arrived at the scene. It is a milestone, not
     * a lifecycle state: the request stays ASIGNADA. The call is idempotent — a
     * repeat returns the same request without re-notifying the requester — and
     * the unit must be the one assigned to the request and belong to the
     * authenticated driver.
     *
     * @return 200 with the ASIGNADA request carrying {@code llegadaEn}; 404
     *         {@code SOLICITUD_NO_ENCONTRADA}; 409 {@code SOLICITUD_NO_ASIGNABLE}
     *         if the request is not ASIGNADA or the unit is not the caller's;
     *         409 {@code AMBULANCIA_NO_DISPONIBLE} if the unit does not exist;
     *         400 {@code DATOS_INVALIDOS}; 500 {@code ERROR_LLEGADA_SOLICITUD}
     */
    @PostMapping("/{id}/llegada")
    public ResponseEntity<Object> llegada(@PathVariable UUID id, @RequestBody AceptarSolicitudRequest request) {
        try {
            if (request == null || request.ambulanciaId() == null) {
                throw new IllegalArgumentException("La ambulancia es obligatoria.");
            }
            SolicitudAmbulancia llegada =
                    declararLlegadaUseCase.declararLlegada(id, request.ambulanciaId(), usuarioAutenticadoId());
            return ResponseEntity.ok(SolicitudAmbulanciaDto.fromDomain(llegada));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (SolicitudNoAsignableException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_SOLICITUD_NO_ASIGNABLE));
        } catch (AmbulanciaNoDisponibleException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("AMBULANCIA_NO_DISPONIBLE", MENSAJE_AMBULANCIA_NO_DISPONIBLE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_LLEGADA));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_LLEGADA_SOLICITUD", MENSAJE_ERROR_LLEGADA));
        }
    }

    /**
     * The help center (the authenticated user) confirms the assigned unit.
     *
     * @return 200 with the CONFIRMED request; 404
     *         {@code SOLICITUD_NO_ENCONTRADA}; 409 {@code SOLICITUD_NO_ASIGNABLE}
     *         if it is not ASIGNADA; 500 {@code ERROR_CONFIRMACION_SOLICITUD}
     */
    @PostMapping("/{id}/confirmar")
    public ResponseEntity<Object> confirmar(@PathVariable UUID id) {
        try {
            UUID centroAyudaId = usuarioAutenticadoId();
            SolicitudAmbulancia confirmada = confirmarSolicitudUseCase.confirmar(id, centroAyudaId);
            return ResponseEntity.ok(SolicitudAmbulanciaDto.fromDomain(confirmada));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (SolicitudNoAsignableException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_SOLICITUD_NO_ASIGNABLE));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONFIRMACION_SOLICITUD", MENSAJE_ERROR_CONFIRMACION));
        }
    }

    /** The authenticated principal is the {@code Usuario} set by the JWT filter. */
    private UUID usuarioAutenticadoId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return usuario.getId();
    }
}
