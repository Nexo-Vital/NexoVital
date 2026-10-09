package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudAjenaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.LlegadaNoDeclaradaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudYaAsignadaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudYaRechazadaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoNotificadaException;
import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.CancelarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConsultarDetalleSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DeclararLlegadaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.FinalizarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.RechazarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AceptarSolicitudRequest;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AceptarSolicitudResponse;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.RechazarSolicitudRequest;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.SolicitudAmbulanciaDto;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.SolicitudRequest;
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
@Tag(name = "flota")
public class SolicitudController {

    private static final String MENSAJE_DATOS_INVALIDOS =
            "La solicitud no es válida: indique la ubicación del pedido.";
    private static final String MENSAJE_DATOS_ACEPTACION = "El accept no es válido: indique la ambulancia.";
    private static final String MENSAJE_DATOS_RECHAZO = "El reject no es válido: indique la ambulancia.";
    private static final String MENSAJE_DATOS_LLEGADA = "La llegada no es válida: indique la ambulancia.";
    private static final String MENSAJE_DATOS_FINALIZACION =
            "El cierre del servicio no es válido: indique la ambulancia.";
    private static final String MENSAJE_SOLICITUD_NO_ENCONTRADA =
            "No existe una solicitud con el identificador indicado.";
    private static final String MENSAJE_SOLICITUD_NO_ASIGNABLE =
            "La solicitud ya no admite esa transición.";
    private static final String MENSAJE_SOLICITUD_AJENA =
            "Solo el solicitante puede cancelar su propia solicitud.";
    private static final String MENSAJE_SOLICITUD_NO_NOTIFICADA =
            "Esta solicitud no fue notificada a tu ambulancia.";
    private static final String MENSAJE_CAS_PERDIDO = "Solicitud ya asignada a otra ambulancia.";
    private static final String MENSAJE_SOLICITUD_YA_RECHAZADA = "Ya rechazaste esta solicitud.";
    private static final String MENSAJE_LLEGADA_NO_DECLARADA =
            "La ambulancia todavía no ha declarado su llegada.";
    private static final String MENSAJE_AMBULANCIA_NO_DISPONIBLE =
            "No hay ambulancias disponibles para atender la solicitud.";
    private static final String MENSAJE_ERROR_SOLICITUD = "No fue posible registrar la solicitud.";
    private static final String MENSAJE_ERROR_ACEPTACION = "No fue posible aceptar la solicitud.";
    private static final String MENSAJE_ERROR_RECHAZO = "No fue posible rechazar la solicitud.";
    private static final String MENSAJE_ERROR_LLEGADA = "No fue posible declarar la llegada.";
    private static final String MENSAJE_ERROR_FINALIZACION = "No fue posible finalizar el servicio.";
    private static final String MENSAJE_ERROR_CONFIRMACION = "No fue posible confirmar la solicitud.";
    private static final String MENSAJE_ERROR_CANCELACION = "No fue posible cancelar la solicitud.";
    private static final String MENSAJE_ERROR_DETALLE = "No fue posible consultar la solicitud.";

    private final SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;
    private final AceptarSolicitudUseCase aceptarSolicitudUseCase;
    private final RechazarSolicitudUseCase rechazarSolicitudUseCase;
    private final DeclararLlegadaUseCase declararLlegadaUseCase;
    private final FinalizarSolicitudUseCase finalizarSolicitudUseCase;
    private final ConfirmarSolicitudUseCase confirmarSolicitudUseCase;
    private final CancelarSolicitudUseCase cancelarSolicitudUseCase;
    private final ConsultarDetalleSolicitudUseCase consultarDetalleSolicitudUseCase;

    public SolicitudController(SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase,
                               AceptarSolicitudUseCase aceptarSolicitudUseCase,
                               RechazarSolicitudUseCase rechazarSolicitudUseCase,
                               DeclararLlegadaUseCase declararLlegadaUseCase,
                               FinalizarSolicitudUseCase finalizarSolicitudUseCase,
                               ConfirmarSolicitudUseCase confirmarSolicitudUseCase,
                               CancelarSolicitudUseCase cancelarSolicitudUseCase,
                               ConsultarDetalleSolicitudUseCase consultarDetalleSolicitudUseCase) {
        this.solicitarAmbulanciaUseCase = solicitarAmbulanciaUseCase;
        this.aceptarSolicitudUseCase = aceptarSolicitudUseCase;
        this.rechazarSolicitudUseCase = rechazarSolicitudUseCase;
        this.declararLlegadaUseCase = declararLlegadaUseCase;
        this.finalizarSolicitudUseCase = finalizarSolicitudUseCase;
        this.confirmarSolicitudUseCase = confirmarSolicitudUseCase;
        this.cancelarSolicitudUseCase = cancelarSolicitudUseCase;
        this.consultarDetalleSolicitudUseCase = consultarDetalleSolicitudUseCase;
    }

    /**
     * Broadcasts the request to every available unit (no zone filter). The
     * authenticated citizen is persisted as the requester and receives the
     * lifecycle on their own user destination. The only mandatory field is the
     * pickup location; the emergency, the aid center and the zone are optional
     * context, because a request no longer depends on an affected zone.
     *
     * @return 201 with the created request; 409 {@code AMBULANCIA_NO_DISPONIBLE}
     *         if no unit is available; 400 {@code DATOS_INVALIDOS} when the
     *         location is missing or not finite; 500
     *         {@code ERROR_REGISTRO_SOLICITUD} if persistence fails
     */
    @PostMapping
    @Operation(summary = "Solicitar una ambulancia (broadcast a todas las disponibles)")
    public ResponseEntity<Object> solicitar(@RequestBody SolicitudRequest request) {
        try {
            if (request == null || request.ubicacion() == null) {
                throw new IllegalArgumentException("La ubicación del pedido es obligatoria.");
            }
            double lat = request.ubicacion().lat();
            double lng = request.ubicacion().lng();
            if (!Double.isFinite(lat) || !Double.isFinite(lng)) {
                throw new IllegalArgumentException("La ubicación del pedido debe ser un punto válido.");
            }
            UUID solicitanteId = usuarioAutenticadoId();
            SolicitudAmbulancia creada = solicitarAmbulanciaUseCase.solicitar(
                    lat, lng, request.emergenciaId(), request.centroAyudaId(), request.zonaId(),
                    // The accept window is fixed by the server (EP-04.F2.US6, M-03):
                    // the client clock is never trusted, so null asks for the
                    // configured window counted from the server's own clock.
                    solicitanteId, null);
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
     * Detail of a request for the driver who was notified of it (EP-04.F2.US3):
     * the pickup point, when it was raised, until when it can be answered, the
     * notified units and its current state. The unit is resolved from the
     * authenticated driver, so no unit id is sent. The state does not filter: a
     * request that was taken, expired or cancelled stays readable by the units
     * it reached.
     *
     * @return 200 with the request; 404 {@code SOLICITUD_NO_ENCONTRADA}; 403
     *         {@code SOLICITUD_NO_NOTIFICADA} when the request was neither
     *         notified nor assigned to the caller's unit, or the caller drives
     *         no unit; 500 {@code ERROR_CONSULTA_SOLICITUD}
     */
    @GetMapping("/{id}")
    @Operation(summary = "Detalle de una solicitud notificada a la ambulancia del conductor")
    public ResponseEntity<Object> detalle(@PathVariable UUID id) {
        try {
            SolicitudAmbulancia solicitud =
                    consultarDetalleSolicitudUseCase.consultar(id, usuarioAutenticadoId());
            return ResponseEntity.ok(SolicitudAmbulanciaDto.fromDomain(solicitud));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (SolicitudNoNotificadaException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ErrorResponse.of("SOLICITUD_NO_NOTIFICADA", MENSAJE_SOLICITUD_NO_NOTIFICADA));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_SOLICITUD", MENSAJE_ERROR_DETALLE));
        }
    }

    /**
     * First accept wins the CAS (AC2). A loser gets 409.
     *
     * <p>A notified unit that loses always reads "Solicitud ya asignada a otra
     * ambulancia.": with {@code CAS_PERDIDO} when it lost inside the conditional
     * UPDATE, and with {@code SOLICITUD_NO_ASIGNABLE} when it arrived after the
     * winner committed (EP-04.F2.US4).
     *
     * <p>A unit that declined the request before gets 409
     * {@code SOLICITUD_YA_RECHAZADA}: the request is still open for the other
     * units, but a decline is final for the one that made it (EP-04.F2.US5).
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
    @Operation(summary = "Aceptar la solicitud (el primer accept gana)")
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
        } catch (SolicitudYaRechazadaException e) {
            // The unit declined this request before (EP-04.F2.US5). Its own
            // code, so the console never reads it as "another unit took it".
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_YA_RECHAZADA", MENSAJE_SOLICITUD_YA_RECHAZADA));
        } catch (SolicitudYaAsignadaException e) {
            // The accept arrived after another unit won. Same reason the loser
            // of the CAS reads; the code stays SOLICITUD_NO_ASIGNABLE because
            // this caller lost to a request that had already moved, not to the
            // conditional UPDATE. Caught before its supertype on purpose.
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_CAS_PERDIDO));
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
     * (AC4), so a subsequent accept by another unit still succeeds. The decline
     * is recorded: the answer carries the unit in {@code ambulanciasRechazaron}
     * and that unit can no longer accept this request (EP-04.F2.US5). Declining
     * again answers the same 200 and changes nothing. The unit
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
    @Operation(summary = "Rechazar la solicitud (sigue pendiente para las demas)")
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
    @Operation(summary = "Declarar la llegada al sitio")
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
     * The assigned driver finishes the service: the request is closed and the
     * unit returns to available in the SAME atomic operation (EP-04.F2.US6 /
     * US11). The unit must be the one assigned to the request and belong to the
     * authenticated driver, exactly as arrival requires.
     *
     * @return 200 with the closed (TOMADA) request; 404
     *         {@code SOLICITUD_NO_ENCONTRADA}; 409 {@code SOLICITUD_NO_ASIGNABLE}
     *         if the request is not in service or the unit is not the caller's;
     *         409 {@code AMBULANCIA_NO_DISPONIBLE} if the unit is not EN_MISION;
     *         409 {@code LLEGADA_NO_DECLARADA} if the unit has not declared
     *         its arrival yet (EP-04.F2.US8);
     *         400 {@code DATOS_INVALIDOS}; 500 {@code ERROR_FINALIZACION_SOLICITUD}
     */
    @PostMapping("/{id}/finalizar")
    @Operation(summary = "Finalizar el servicio y liberar la unidad")
    public ResponseEntity<Object> finalizar(@PathVariable UUID id, @RequestBody AceptarSolicitudRequest request) {
        try {
            if (request == null || request.ambulanciaId() == null) {
                throw new IllegalArgumentException("La ambulancia es obligatoria.");
            }
            SolicitudAmbulancia finalizada = finalizarSolicitudUseCase.finalizar(
                    id, request.ambulanciaId(), usuarioAutenticadoId());
            return ResponseEntity.ok(SolicitudAmbulanciaDto.fromDomain(finalizada));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (LlegadaNoDeclaradaException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("LLEGADA_NO_DECLARADA", MENSAJE_LLEGADA_NO_DECLARADA));
        } catch (SolicitudNoAsignableException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_SOLICITUD_NO_ASIGNABLE));
        } catch (AmbulanciaNoDisponibleException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("AMBULANCIA_NO_DISPONIBLE", MENSAJE_AMBULANCIA_NO_DISPONIBLE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_FINALIZACION));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_FINALIZACION_SOLICITUD", MENSAJE_ERROR_FINALIZACION));
        }
    }

    /**
     * The requester (the citizen who raised the request) confirms the assigned
     * unit. The request's aid center is an organization id the principal cannot
     * resolve, so the caller is bound to the request's own {@code solicitanteId}.
     *
     * @return 200 with the CONFIRMED request; 404
     *         {@code SOLICITUD_NO_ENCONTRADA}; 409 {@code SOLICITUD_NO_ASIGNABLE}
     *         if it is not ASIGNADA or the caller is not the requester; 409
     *         {@code LLEGADA_NO_DECLARADA} if the unit has not declared its
     *         arrival yet (EP-04.F2.US8); 500
     *         {@code ERROR_CONFIRMACION_SOLICITUD}
     */
    @PostMapping("/{id}/confirmar")
    @Operation(summary = "Confirmar la unidad asignada")
    public ResponseEntity<Object> confirmar(@PathVariable UUID id) {
        try {
            UUID solicitanteId = usuarioAutenticadoId();
            SolicitudAmbulancia confirmada = confirmarSolicitudUseCase.confirmar(id, solicitanteId);
            return ResponseEntity.ok(SolicitudAmbulanciaDto.fromDomain(confirmada));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (LlegadaNoDeclaradaException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("LLEGADA_NO_DECLARADA", MENSAJE_LLEGADA_NO_DECLARADA));
        } catch (SolicitudNoAsignableException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_SOLICITUD_NO_ASIGNABLE));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONFIRMACION_SOLICITUD", MENSAJE_ERROR_CONFIRMACION));
        }
    }

    /**
     * The requester withdraws their own still-open request. Only the citizen who
     * raised it may cancel, and only while no unit accepted: once a unit is
     * assigned the ambulance is on its way, so the transition is refused with
     * 409 and an honest reason instead of pretending to stop it. The close is a
     * CAS, so a cancel racing an accept never both wins and never turns into a
     * 500.
     *
     * @return 200 with the CANCELADA request; 404
     *         {@code SOLICITUD_NO_ENCONTRADA}; 403 {@code SOLICITUD_AJENA} when
     *         the caller is not the requester; 409
     *         {@code SOLICITUD_NO_ASIGNABLE} when it is no longer PENDIENTE; 500
     *         {@code ERROR_CANCELACION_SOLICITUD}
     */
    @PostMapping("/{id}/cancelar")
    @Operation(summary = "Cancelar la solicitud (solo el solicitante, mientras este pendiente)")
    public ResponseEntity<Object> cancelar(@PathVariable UUID id) {
        try {
            UUID solicitanteId = usuarioAutenticadoId();
            SolicitudAmbulancia cancelada = cancelarSolicitudUseCase.cancelar(id, solicitanteId);
            return ResponseEntity.ok(SolicitudAmbulanciaDto.fromDomain(cancelada));
        } catch (SolicitudNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("SOLICITUD_NO_ENCONTRADA", MENSAJE_SOLICITUD_NO_ENCONTRADA));
        } catch (SolicitudAjenaException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ErrorResponse.of("SOLICITUD_AJENA", MENSAJE_SOLICITUD_AJENA));
        } catch (SolicitudNoAsignableException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("SOLICITUD_NO_ASIGNABLE", MENSAJE_SOLICITUD_NO_ASIGNABLE));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CANCELACION_SOLICITUD", MENSAJE_ERROR_CANCELACION));
        }
    }

    /** The authenticated principal is the {@code Usuario} set by the JWT filter. */
    private UUID usuarioAutenticadoId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return usuario.getId();
    }
}
