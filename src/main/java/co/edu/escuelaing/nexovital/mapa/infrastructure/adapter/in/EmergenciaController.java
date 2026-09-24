package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ReportarEmergenciaUseCase;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto.EmergenciaDto;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto.EmergenciaRequest;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;

/**
 * Adaptador de entrada de emergencias. El recurso es {@code emergencias}
 * (sustantivo plural): {@code POST /api/v1/emergencias}, la ruta que ya fija el
 * contrato OpenAPI para reportar una emergencia (US3).
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

    private final ReportarEmergenciaUseCase reportarEmergenciaUseCase;

    public EmergenciaController(ReportarEmergenciaUseCase reportarEmergenciaUseCase) {
        this.reportarEmergenciaUseCase = reportarEmergenciaUseCase;
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
