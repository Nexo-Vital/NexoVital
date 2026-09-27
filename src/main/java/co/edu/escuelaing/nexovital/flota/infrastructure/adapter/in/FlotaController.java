package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConsultarFlotaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto.AmbulanciaDto;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
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
public class FlotaController {

    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar la flota.";
    private static final String MENSAJE_ERROR_CONSULTA_PROPIA =
            "No fue posible consultar tu ambulancia.";

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

    /** The authenticated principal is the {@code Usuario} set by the JWT filter. */
    private UUID usuarioAutenticadoId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return usuario.getId();
    }
}
