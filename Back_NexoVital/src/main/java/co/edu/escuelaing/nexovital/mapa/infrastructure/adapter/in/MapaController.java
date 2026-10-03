package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.mapa.domain.port.in.ConsultarMapaUseCase;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.in.dto.MapaDto;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Adaptador de entrada del mapa. El recurso es {@code mapa} (sustantivo
 * singular): {@code GET /api/v1/mapa}, la ruta que el contrato OpenAPI fija.
 *
 * <p>El manejo de errores vive aquí, dentro del módulo {@code mapa}, con
 * {@code try/catch} y el envelope {@code ErrorResponse}: el repositorio no
 * tiene {@code @ControllerAdvice}.
 */
@RestController
@RequestMapping("/api/v1/mapa")
@Tag(name = "mapa")
public class MapaController {

    private static final Logger LOG = LoggerFactory.getLogger(MapaController.class);

    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar el mapa.";

    private final ConsultarMapaUseCase consultarMapaUseCase;

    public MapaController(ConsultarMapaUseCase consultarMapaUseCase) {
        this.consultarMapaUseCase = consultarMapaUseCase;
    }

    /**
     * Devuelve las zonas y los centros con su ubicación.
     *
     * @return 200 con {@code {zonas, centros}}; 500 {@code ERROR_CONSULTA_MAPA}
     *         si la consulta falla
     */
    @GetMapping
    @Operation(summary = "Consultar el mapa (zonas y centros con su ubicacion)")
    public ResponseEntity<Object> consultar() {
        try {
            return ResponseEntity.ok(MapaDto.fromDomain(consultarMapaUseCase.consultar()));
        } catch (RuntimeException e) {
            // El cliente recibe un mensaje genérico a propósito; la causa real
            // queda en el log del servidor para poder diagnosticar la falla.
            LOG.error("Fallo al consultar el mapa (GET /api/v1/mapa)", e);
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_MAPA", MENSAJE_ERROR_CONSULTA));
        }
    }
}
