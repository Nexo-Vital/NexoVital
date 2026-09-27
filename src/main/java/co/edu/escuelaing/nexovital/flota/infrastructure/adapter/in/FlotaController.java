package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.port.in.ConsultarFlotaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AmbulanciaDto;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Inbound adapter of the fleet read model: {@code GET
 * /api/v1/flota/ambulancias}, the path the OpenAPI contract fixes (AC5).
 *
 * <p>Error handling lives here, inside {@code flota}, with {@code try/catch}
 * and the {@code ErrorResponse} envelope: this repository has no
 * {@code @ControllerAdvice}. An empty array is a valid 200.
 */
@RestController
@RequestMapping("/api/v1/flota")
public class FlotaController {

    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar la flota.";

    private final ConsultarFlotaUseCase consultarFlotaUseCase;

    public FlotaController(ConsultarFlotaUseCase consultarFlotaUseCase) {
        this.consultarFlotaUseCase = consultarFlotaUseCase;
    }

    /**
     * @return 200 with the {@code AmbulanciaDto} array (position and state);
     *         500 {@code ERROR_CONSULTA_FLOTA} if the query fails
     */
    @GetMapping("/ambulancias")
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
}
