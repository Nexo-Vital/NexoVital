package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.port.in.ConsultarAuditoriaUseCase;
import co.edu.escuelaing.nexovital.auditoria.domain.port.in.ConsultarBitacoraUseCase;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in.dto.EventoAuditoriaDto;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in.dto.PeticionRegistradaDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Adaptador de entrada de la bitácora.
 *
 * <p>Dos lecturas y nada más: la traza de una emergencia y la de un centro de
 * acopio. No hay {@code POST}, {@code PUT}, {@code PATCH} ni {@code DELETE}: un
 * registro que la aplicación puede reescribir deja de servir como prueba.
 *
 * <p>Un identificador sin eventos devuelve {@code 200} con una lista vacía, no
 * {@code 404}: la consulta fue válida y la respuesta honesta es "no hay nada
 * registrado para ese recurso", no "ese recurso no existe".
 *
 * <p>{@code GET /peticiones} (T15) consulta la bitácora de TODAS las
 * peticiones: por petición ({@code traceId}), por usuario, por emergencia o
 * centro ({@code recursoId}) y por ventana de tiempo. Devuelve lo más reciente
 * primero, 100 filas por defecto y 1000 como máximo.
 */
@RestController
@RequestMapping("/api/v1/auditoria")
@Tag(name = "auditoria")
public class AuditoriaController {

    private final ConsultarAuditoriaUseCase consultarAuditoriaUseCase;
    private final ConsultarBitacoraUseCase consultarBitacoraUseCase;

    public AuditoriaController(ConsultarAuditoriaUseCase consultarAuditoriaUseCase,
                               ConsultarBitacoraUseCase consultarBitacoraUseCase) {
        this.consultarAuditoriaUseCase = consultarAuditoriaUseCase;
        this.consultarBitacoraUseCase = consultarBitacoraUseCase;
    }

    @GetMapping("/peticiones")
    @Operation(summary = "Bitacora de peticiones: por traceId, usuario, emergencia o centro, lo mas reciente primero")
    public List<PeticionRegistradaDto> peticiones(
            @RequestParam(required = false) String traceId,
            @RequestParam(required = false) UUID usuarioId,
            @RequestParam(required = false) UUID emergenciaId,
            @RequestParam(required = false) UUID centroId,
            @RequestParam(required = false) Instant desde,
            @RequestParam(required = false) Instant hasta,
            @RequestParam(required = false, defaultValue = "0") int limite) {
        UUID recursoId = emergenciaId != null ? emergenciaId : centroId;
        return consultarBitacoraUseCase.buscar(
                        new FiltroBitacora(traceId, usuarioId, recursoId, desde, hasta, limite))
                .stream()
                .map(PeticionRegistradaDto::fromDomain)
                .toList();
    }

    @GetMapping("/emergencias/{emergenciaId}")
    @Operation(summary = "Traza de auditoria de una emergencia, en orden cronologico")
    public List<EventoAuditoriaDto> porEmergencia(@PathVariable UUID emergenciaId) {
        return consultarAuditoriaUseCase.porEmergencia(emergenciaId).stream()
                .map(EventoAuditoriaDto::fromDomain)
                .toList();
    }

    @GetMapping("/centros/{centroId}")
    @Operation(summary = "Traza de auditoria de un centro de acopio, en orden cronologico")
    public List<EventoAuditoriaDto> porCentro(@PathVariable UUID centroId) {
        return consultarAuditoriaUseCase.porCentro(centroId).stream()
                .map(EventoAuditoriaDto::fromDomain)
                .toList();
    }
}
