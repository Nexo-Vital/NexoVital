package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.OrganizacionDuplicadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.CrearOrganizacionUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.OrganizacionDto;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.OrganizacionRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Locale;

/**
 * Adaptador de entrada de organizaciones. El recurso es {@code organizaciones}
 * (sustantivo plural): {@code GET /api/v1/organizaciones} y {@code POST
 * /api/v1/organizaciones} (registrar un centro), las rutas que ya fija el
 * contrato OpenAPI.
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
    private static final String MENSAJE_ERROR_REGISTRO = "No fue posible registrar la organización.";

    private final ListarOrganizacionesUseCase listarOrganizacionesUseCase;
    private final CrearOrganizacionUseCase crearOrganizacionUseCase;

    public OrganizacionController(ListarOrganizacionesUseCase listarOrganizacionesUseCase,
                                  CrearOrganizacionUseCase crearOrganizacionUseCase) {
        this.listarOrganizacionesUseCase = listarOrganizacionesUseCase;
        this.crearOrganizacionUseCase = crearOrganizacionUseCase;
    }

    /**
     * Registra una organización. El servidor asigna el {@code id}; {@code zonaId}
     * es opcional (decisión D2). El mensaje de error nombra el campo que falta,
     * como pide el AC3.
     *
     * @return 201 con la {@code OrganizacionDto}; 400 {@code DATOS_INVALIDOS} si
     *         falta un campo obligatorio; 400 {@code ORGANIZACION_DUPLICADA} si
     *         el nombre ya está registrado; 500 si el registro falla
     */
    @PostMapping
    public ResponseEntity<Object> crear(@RequestBody OrganizacionRequest request) {
        try {
            TipoOrganizacion tipo = parsearTipoRequerido(request.tipo());
            Ubicacion ubicacion = construirUbicacion(request.ubicacion());
            Organizacion organizacion = crearOrganizacionUseCase.crear(
                    request.nombre(), tipo, ubicacion, request.zonaId());
            return ResponseEntity.status(HttpStatus.CREATED).body(OrganizacionDto.fromDomain(organizacion));
        } catch (OrganizacionDuplicadaException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("ORGANIZACION_DUPLICADA", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_REGISTRO_ORGANIZACION", MENSAJE_ERROR_REGISTRO));
        }
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

    /**
     * @return el tipo del cuerpo, obligatorio
     * @throws IllegalArgumentException si falta o no corresponde a ningún tipo
     */
    private static TipoOrganizacion parsearTipoRequerido(String tipo) {
        if (tipo == null || tipo.isBlank()) {
            throw new IllegalArgumentException("El tipo de organización es obligatorio.");
        }
        try {
            return TipoOrganizacion.valueOf(tipo.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(MENSAJE_TIPO_INVALIDO);
        }
    }

    /**
     * @return la ubicación de dominio, que valida el rango lat/lng
     * @throws IllegalArgumentException si falta o está fuera de rango
     */
    private static Ubicacion construirUbicacion(OrganizacionRequest.UbicacionRequest ubicacion) {
        if (ubicacion == null || ubicacion.lat() == null || ubicacion.lng() == null) {
            throw new IllegalArgumentException("La ubicación es obligatoria.");
        }
        return new Ubicacion(ubicacion.lat(), ubicacion.lng());
    }
}
