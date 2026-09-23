package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.OrganizacionDto;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Locale;

/**
 * Adaptador de entrada de organizaciones. El recurso es {@code organizaciones}
 * (sustantivo plural): {@code GET /api/v1/organizaciones}, la ruta que ya fija
 * el contrato OpenAPI.
 *
 * <p>El manejo de errores vive aquí, dentro del módulo {@code usuarios}, con
 * {@code try/catch} y el envelope {@code ErrorResponse}: el repositorio no
 * tiene {@code @ControllerAdvice}.
 */
@RestController
@RequestMapping("/api/v1/organizaciones")
public class OrganizacionController {

    private static final String MENSAJE_TIPO_INVALIDO =
            "El tipo de organización no es válido. Valores admitidos: CENTRO_AYUDA, CENTRO_ACOPIO.";

    private final ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    public OrganizacionController(ListarOrganizacionesUseCase listarOrganizacionesUseCase) {
        this.listarOrganizacionesUseCase = listarOrganizacionesUseCase;
    }

    /**
     * Lista las organizaciones, con filtro opcional por {@code tipo}.
     *
     * @return 200 con el arreglo de organizaciones; 400 {@code TIPO_INVALIDO} si
     *         el query param {@code tipo} no es un valor del enum
     */
    @GetMapping
    public ResponseEntity<Object> listar(@RequestParam(name = "tipo", required = false) String tipo) {
        TipoOrganizacion filtro;
        try {
            filtro = parsearTipo(tipo);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ErrorResponse.of("TIPO_INVALIDO", MENSAJE_TIPO_INVALIDO));
        }

        List<OrganizacionDto> organizaciones = listarOrganizacionesUseCase.listar(filtro).stream()
                .map(OrganizacionDto::fromDomain)
                .toList();
        return ResponseEntity.ok(organizaciones);
    }

    /**
     * @return el tipo normalizado, o {@code null} si no se envió filtro
     * @throws IllegalArgumentException si el valor no corresponde a ningún tipo
     */
    private static TipoOrganizacion parsearTipo(String tipo) {
        if (tipo == null || tipo.isBlank()) {
            return null;
        }
        return TipoOrganizacion.valueOf(tipo.trim().toUpperCase(Locale.ROOT));
    }
}
