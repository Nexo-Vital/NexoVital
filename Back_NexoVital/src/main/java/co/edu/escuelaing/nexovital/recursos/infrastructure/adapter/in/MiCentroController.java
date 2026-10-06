package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroPropioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroYaRegistradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioDuplicadoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.NombreCentroDuplicadoException;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.model.MiCentro;
import co.edu.escuelaing.nexovital.recursos.domain.model.NuevoItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.AdministrarMiCentroUseCase;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.MiCentroDto;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.MiCentroRequest;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.NuevoItemRequest;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Adaptador de entrada del centro PROPIO del administrador de centro de ayuda
 * ({@code /api/v1/centros-acopio/mio}). El centro se resuelve en el servidor a
 * partir del usuario autenticado: el cliente nunca envía un id de centro, así
 * que un administrador no puede crear ni modificar el centro de otro.
 *
 * <p>Las tres operaciones exigen {@code ROLE_ADMIN_CENTRO_AYUDA}
 * ({@code SecurityConfig}). Retirar unidades de un insumo usa el despacho que ya
 * existe ({@code POST /centros-acopio/{id}/inventario/despacho}).
 *
 * <p>El manejo de errores vive aquí, con {@code try/catch} y el envelope
 * {@code ErrorResponse}, igual que en {@link InventarioController}. El orden de
 * los {@code catch} importa: las excepciones propias caen antes que
 * {@link IllegalArgumentException} (400) y esta antes que la genérica (500).
 */
@RestController
@RequestMapping("/api/v1/centros-acopio/mio")
@Tag(name = "recursos")
public class MiCentroController {

    private static final String MENSAJE_SIN_CENTRO = "Todavía no has creado tu centro.";
    private static final String MENSAJE_YA_REGISTRADO = "Ya tienes un centro registrado.";
    private static final String MENSAJE_NOMBRE_DUPLICADO = "Ya existe un centro con ese nombre. Elige otro.";
    private static final String MENSAJE_ITEM_DUPLICADO = "Tu centro ya tiene un insumo con ese nombre.";
    private static final String MENSAJE_CONFLICTO =
            "No fue posible guardar: ya tienes un centro o el nombre ya está en uso.";
    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar tu centro.";
    private static final String MENSAJE_ERROR_CREACION = "No fue posible crear el centro.";
    private static final String MENSAJE_ERROR_ITEM = "No fue posible agregar el insumo.";

    private final AdministrarMiCentroUseCase administrarMiCentroUseCase;

    public MiCentroController(AdministrarMiCentroUseCase administrarMiCentroUseCase) {
        this.administrarMiCentroUseCase = administrarMiCentroUseCase;
    }

    /**
     * @return 200 con el {@code MiCentroDto}; 404 {@code CENTRO_NO_REGISTRADO} si
     *         el administrador todavía no creó su centro; 500 si la consulta falla
     */
    @GetMapping
    @Operation(summary = "Centro del administrador autenticado, con su inventario")
    public ResponseEntity<Object> consultar() {
        try {
            return administrarMiCentroUseCase.consultar(usuarioAutenticadoId())
                    .<ResponseEntity<Object>>map(centro -> ResponseEntity.ok(MiCentroDto.fromDomain(centro)))
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                            .body(ErrorResponse.of("CENTRO_NO_REGISTRADO", MENSAJE_SIN_CENTRO)));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_CENTRO", MENSAJE_ERROR_CONSULTA));
        }
    }

    /**
     * Crea el centro del administrador con sus insumos iniciales.
     *
     * @return 201 con el {@code MiCentroDto}; 400 {@code DATOS_INVALIDOS} con un
     *         mensaje que nombra el dato que falla; 409
     *         {@code CENTRO_YA_REGISTRADO} si ya tiene uno; 409
     *         {@code NOMBRE_CENTRO_DUPLICADO} si el nombre ya existe; 500 si el
     *         registro falla
     */
    @PostMapping
    @Operation(summary = "Crear el centro del administrador con sus insumos")
    public ResponseEntity<Object> crear(@RequestBody MiCentroRequest request) {
        try {
            if (request == null) {
                throw new IllegalArgumentException("Los datos del centro son obligatorios.");
            }
            List<NuevoItemInventario> items = request.items() == null
                    ? List.of()
                    : request.items().stream()
                            .map(item -> item == null ? null : item.aDominio())
                            .toList();
            Double lat = request.ubicacion() == null ? null : request.ubicacion().lat();
            Double lng = request.ubicacion() == null ? null : request.ubicacion().lng();
            MiCentro creado = administrarMiCentroUseCase.crear(
                    usuarioAutenticadoId(), request.nombre(), lat, lng, items);
            return ResponseEntity.status(HttpStatus.CREATED).body(MiCentroDto.fromDomain(creado));
        } catch (CentroYaRegistradoException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("CENTRO_YA_REGISTRADO", MENSAJE_YA_REGISTRADO));
        } catch (NombreCentroDuplicadoException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("NOMBRE_CENTRO_DUPLICADO", MENSAJE_NOMBRE_DUPLICADO));
        } catch (DataIntegrityViolationException e) {
            // Dos creaciones simultáneas: la restricción única de la tabla es la
            // que decide, y la perdedora se reporta como conflicto, no como 500.
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("CENTRO_YA_REGISTRADO", MENSAJE_CONFLICTO));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ErrorResponse.of("DATOS_INVALIDOS", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CREACION_CENTRO", MENSAJE_ERROR_CREACION));
        }
    }

    /**
     * Declara un insumo nuevo en el centro del administrador.
     *
     * @return 201 con el {@code ItemInventarioDto}; 400 {@code DATOS_INVALIDOS};
     *         404 {@code CENTRO_NO_REGISTRADO} si no tiene centro; 409
     *         {@code ITEM_INVENTARIO_DUPLICADO} si el nombre ya existe en su
     *         centro; 500 si el registro falla
     */
    @PostMapping("/inventario")
    @Operation(summary = "Agregar un insumo al centro del administrador")
    public ResponseEntity<Object> agregarItem(@RequestBody NuevoItemRequest request) {
        try {
            if (request == null) {
                throw new IllegalArgumentException("El insumo es obligatorio.");
            }
            ItemInventario creado = administrarMiCentroUseCase.agregarItem(
                    usuarioAutenticadoId(), request.aDominio());
            return ResponseEntity.status(HttpStatus.CREATED).body(ItemInventarioDto.fromDomain(creado));
        } catch (CentroPropioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("CENTRO_NO_REGISTRADO", MENSAJE_SIN_CENTRO));
        } catch (ItemInventarioDuplicadoException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("ITEM_INVENTARIO_DUPLICADO", MENSAJE_ITEM_DUPLICADO));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ErrorResponse.of("DATOS_INVALIDOS", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_REGISTRO_ITEM", MENSAJE_ERROR_ITEM));
        }
    }

    /** El principal autenticado es el {@code Usuario} que fija el filtro JWT. */
    private UUID usuarioAutenticadoId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return usuario.getId();
    }
}
