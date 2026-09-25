package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.mapa.domain.exception.EmergenciaNoEncontradaException;
import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ActualizarEmergenciaUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ListarEmergenciasUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ReportarEmergenciaUseCase;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto.EmergenciaActualizarRequest;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto.EmergenciaDto;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto.EmergenciaRequest;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Adaptador de entrada de emergencias. El recurso es {@code emergencias}
 * (sustantivo plural): {@code POST /api/v1/emergencias}, la ruta que ya fija el
 * contrato OpenAPI para reportar una emergencia (US3), {@code GET
 * /api/v1/emergencias}, la lectura del registro que el diseño D7 contempla para
 * que un cliente que llega tarde vea el estado vigente, y {@code PATCH
 * /api/v1/emergencias/{id}} para corregir estado/nivel (US4).
 *
 * <p>El manejo de errores vive aquí, dentro del módulo {@code mapa}, con
 * {@code try/catch} y el envelope {@code ErrorResponse}: el repositorio no tiene
 * {@code @ControllerAdvice}.
 */
@RestController
@RequestMapping("/api/v1/emergencias")
public class EmergenciaController {

    private static final String MENSAJE_DATOS_INVALIDOS =
            "El reporte no es válido: revise la ubicación, el nivel y la descripción.";
    private static final String MENSAJE_ERROR_REGISTRO = "No fue posible registrar la emergencia.";
    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar las emergencias.";
    private static final String MENSAJE_DATOS_INVALIDOS_ACTUALIZACION =
            "La actualización no es válida: indique el estado o el nivel del contrato.";
    private static final String MENSAJE_EMERGENCIA_NO_ENCONTRADA =
            "No existe una emergencia con el identificador indicado.";
    private static final String MENSAJE_ERROR_ACTUALIZACION = "No fue posible actualizar la emergencia.";

    private final ReportarEmergenciaUseCase reportarEmergenciaUseCase;
    private final ListarEmergenciasUseCase listarEmergenciasUseCase;
    private final ActualizarEmergenciaUseCase actualizarEmergenciaUseCase;

    public EmergenciaController(ReportarEmergenciaUseCase reportarEmergenciaUseCase,
                                ListarEmergenciasUseCase listarEmergenciasUseCase,
                                ActualizarEmergenciaUseCase actualizarEmergenciaUseCase) {
        this.reportarEmergenciaUseCase = reportarEmergenciaUseCase;
        this.listarEmergenciasUseCase = listarEmergenciasUseCase;
        this.actualizarEmergenciaUseCase = actualizarEmergenciaUseCase;
    }

    /**
     * Reporta una emergencia sobre un punto. El servidor asigna {@code id},
     * {@code estado} y {@code createdAt}, y resuelve la {@code zonaId} del punto.
     *
     * @return 201 con la {@code Emergencia}; 400 {@code DATOS_INVALIDOS} si falta
     *         un campo o la geometría está fuera de rango; 500 si el registro
     *         falla
     */
    @PostMapping
    public ResponseEntity<Object> reportar(@RequestBody EmergenciaRequest request) {
        try {
            NivelEmergencia nivel = parsearNivel(request.nivel());
            Ubicacion ubicacion = construirUbicacion(request.ubicacion());
            Emergencia emergencia = reportarEmergenciaUseCase.reportar(ubicacion, nivel, request.descripcion());
            return ResponseEntity.status(HttpStatus.CREATED).body(EmergenciaDto.fromDomain(emergencia));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_INVALIDOS));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_REGISTRO_EMERGENCIA", MENSAJE_ERROR_REGISTRO));
        }
    }

    /**
     * Devuelve el registro de emergencias para que un cliente que se conecta
     * tarde vea el estado vigente. La lista vacía es un 200 válido: no hay
     * emergencias no es un recurso ausente, es una lista sin elementos.
     *
     * @return 200 con la lista de {@code EmergenciaDto} (vacía si no hay
     *         ninguna); 500 {@code ERROR_CONSULTA_EMERGENCIA} si la consulta
     *         falla
     */
    @GetMapping
    public ResponseEntity<Object> listar() {
        try {
            List<EmergenciaDto> emergencias = listarEmergenciasUseCase.listar().stream()
                    .map(EmergenciaDto::fromDomain)
                    .toList();
            return ResponseEntity.ok(emergencias);
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_EMERGENCIA", MENSAJE_ERROR_CONSULTA));
        }
    }

    /**
     * Corrige el estado y/o el nivel de una emergencia existente (contrato
     * {@code updateEmergencia}). Los dos campos del cuerpo son opcionales: el
     * ausente conserva su valor vigente; si no viene ninguno, no hay nada que
     * actualizar y se responde 400 (decisión D2).
     *
     * <p>El orden de los {@code catch} importa: la excepción de "no encontrada"
     * cae en su propio bloque (404) antes que el genérico de
     * {@code RuntimeException} (500).
     *
     * @return 200 con la {@code Emergencia} actualizada; 404
     *         {@code EMERGENCIA_NO_ENCONTRADA} si el id no existe; 400
     *         {@code DATOS_INVALIDOS} si no viene ningún campo o un valor está
     *         fuera del contrato; 500 {@code ERROR_ACTUALIZACION_EMERGENCIA} si
     *         la actualización falla
     */
    @PatchMapping("/{id}")
    public ResponseEntity<Object> actualizar(@PathVariable UUID id,
                                             @RequestBody EmergenciaActualizarRequest request) {
        try {
            EstadoEmergencia estado = parsearEstadoOpcional(request.estado());
            NivelEmergencia nivel = parsearNivelOpcional(request.nivel());
            Emergencia emergencia = actualizarEmergenciaUseCase.actualizar(id, estado, nivel);
            return ResponseEntity.ok(EmergenciaDto.fromDomain(emergencia));
        } catch (EmergenciaNoEncontradaException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("EMERGENCIA_NO_ENCONTRADA", MENSAJE_EMERGENCIA_NO_ENCONTRADA));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_INVALIDOS_ACTUALIZACION));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_ACTUALIZACION_EMERGENCIA", MENSAJE_ERROR_ACTUALIZACION));
        }
    }

    /**
     * @return el estado del contrato, o {@code null} si el campo viene ausente
     *         o en blanco (opcional en el PATCH)
     * @throws IllegalArgumentException si el valor no corresponde a ningún
     *                                  estado del contrato
     */
    private static EstadoEmergencia parsearEstadoOpcional(String estado) {
        if (estado == null || estado.isBlank()) {
            return null;
        }
        return EstadoEmergencia.valueOf(estado.trim().toUpperCase(Locale.ROOT));
    }

    /**
     * @return el nivel del contrato, o {@code null} si el campo viene ausente o
     *         en blanco (opcional en el PATCH)
     * @throws IllegalArgumentException si el valor no corresponde a ningún nivel
     *                                  del contrato
     */
    private static NivelEmergencia parsearNivelOpcional(String nivel) {
        if (nivel == null || nivel.isBlank()) {
            return null;
        }
        return NivelEmergencia.valueOf(nivel.trim().toUpperCase(Locale.ROOT));
    }

    /**
     * @return el nivel del contrato
     * @throws IllegalArgumentException si falta o no corresponde a ningún nivel
     */
    private static NivelEmergencia parsearNivel(String nivel) {
        if (nivel == null || nivel.isBlank()) {
            throw new IllegalArgumentException("El nivel es obligatorio.");
        }
        return NivelEmergencia.valueOf(nivel.trim().toUpperCase(Locale.ROOT));
    }

    /**
     * @return la ubicación de dominio, que valida el rango lat/lng
     * @throws IllegalArgumentException si falta o está fuera de rango
     */
    private static Ubicacion construirUbicacion(EmergenciaRequest.UbicacionRequest ubicacion) {
        if (ubicacion == null || ubicacion.lat() == null || ubicacion.lng() == null) {
            throw new IllegalArgumentException("La ubicación es obligatoria.");
        }
        return new Ubicacion(ubicacion.lat(), ubicacion.lng());
    }
}
