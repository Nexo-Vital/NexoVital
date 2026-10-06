package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.NecesidadCubiertaException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.StockInsuficienteException;
import co.edu.escuelaing.nexovital.recursos.domain.model.DonacionAceptada;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarInventarioUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.DespacharStockUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarDonacionUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.CentroPropioPort;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.DespachoRequest;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.DonacionRequest;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.DonacionResultadoDto;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Adaptador de entrada del inventario de un centro de acopio:
 * {@code GET /api/v1/centros-acopio/{id}/inventario}, la ruta que fija el
 * contrato OpenAPI (EP-03.F1). Devuelve un arreglo de {@code InventarioItem}.
 *
 * <p>El manejo de errores vive aquí, dentro del módulo {@code recursos}, con
 * {@code try/catch} y el envelope {@code ErrorResponse}: el repositorio no tiene
 * {@code @ControllerAdvice}. El orden de los {@code catch} importa: la excepción
 * de "no encontrado" (404) cae antes que la genérica (500).
 */
@RestController
@RequestMapping("/api/v1/centros-acopio")
@Tag(name = "recursos")
public class InventarioController {

    private static final String MENSAJE_CENTRO_NO_ENCONTRADO =
            "No existe un centro de acopio con el identificador indicado.";
    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar el inventario.";
    private static final String MENSAJE_ITEM_NO_ENCONTRADO =
            "No existe el insumo indicado en el centro de acopio.";
    private static final String MENSAJE_DATOS_INVALIDOS =
            "La donación no es válida: revise el insumo y la cantidad.";
    private static final String MENSAJE_NECESIDAD_CUBIERTA =
            "Otro donante cubrió esta necesidad.";
    private static final String MENSAJE_ERROR_DONACION = "No fue posible registrar la donación.";
    private static final String MENSAJE_STOCK_INSUFICIENTE =
            "No hay unidades suficientes del insumo para atender la solicitud.";
    private static final String MENSAJE_DATOS_DESPACHO =
            "El despacho no es válido: revise el insumo y la cantidad.";
    private static final String MENSAJE_NO_ES_DUENO =
            "Solo el administrador del centro puede retirar insumos de él.";
    private static final String MENSAJE_ERROR_DESPACHO = "No fue posible despachar el recurso.";

    private final ConsultarInventarioUseCase consultarInventarioUseCase;
    private final RegistrarDonacionUseCase registrarDonacionUseCase;
    private final DespacharStockUseCase despacharStockUseCase;
    private final CentroPropioPort centroPropioPort;

    public InventarioController(ConsultarInventarioUseCase consultarInventarioUseCase,
                                RegistrarDonacionUseCase registrarDonacionUseCase,
                                DespacharStockUseCase despacharStockUseCase,
                                CentroPropioPort centroPropioPort) {
        this.centroPropioPort = centroPropioPort;
        this.consultarInventarioUseCase = consultarInventarioUseCase;
        this.registrarDonacionUseCase = registrarDonacionUseCase;
        this.despacharStockUseCase = despacharStockUseCase;
    }

    /**
     * Devuelve el inventario del centro con el semáforo de cada item. Un arreglo
     * vacío es un 200 válido: un centro existente sin inventario declarado no es
     * un recurso ausente.
     *
     * @return 200 con el arreglo de {@code ItemInventarioDto}; 404
     *         {@code CENTRO_ACOPIO_NO_ENCONTRADO} si no existe un centro con ese
     *         id; 500 {@code ERROR_CONSULTA_INVENTARIO} si la consulta falla
     */
    @GetMapping("/{id}/inventario")
    @Operation(summary = "Inventario de un centro de acopio con su semaforo")
    public ResponseEntity<Object> consultar(@PathVariable UUID id) {
        try {
            List<ItemInventarioDto> items = consultarInventarioUseCase.consultar(id).stream()
                    .map(ItemInventarioDto::fromDomain)
                    .toList();
            return ResponseEntity.ok(items);
        } catch (CentroAcopioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("CENTRO_ACOPIO_NO_ENCONTRADO", MENSAJE_CENTRO_NO_ENCONTRADO));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_CONSULTA_INVENTARIO", MENSAJE_ERROR_CONSULTA));
        }
    }

    /**
     * Registra una donación: acredita stock al item indicado, acotado a lo que
     * todavía falta ({@code requerido - disponible}). Si el donante ofrece más
     * de lo que falta, se acepta solo lo necesario para completar; si la
     * necesidad ya está cubierta (otro donante la completó antes), se rechaza.
     * El crédito lo aplica el servicio con una sola sentencia atómica dentro de
     * su transacción; el controlador nunca es el disparador del push.
     *
     * <p>El orden de los {@code catch} importa: las excepciones de "no
     * encontrado" (404) caen antes que {@link IllegalArgumentException} (400), y
     * esta antes que la genérica (500).
     *
     * @return 200 con el {@code DonacionResultadoDto} (item acreditado, cantidad
     *         aceptada y ofrecida); 404 {@code CENTRO_ACOPIO_NO_ENCONTRADO} si no
     *         existe el centro; 404 {@code ITEM_INVENTARIO_NO_ENCONTRADO} si el
     *         item no existe en ese centro; 409 {@code NECESIDAD_CUBIERTA} si ya
     *         no falta nada; 400 {@code DATOS_INVALIDOS} si falta el item o la
     *         cantidad no es un entero positivo; 500
     *         {@code ERROR_REGISTRO_DONACION} si el registro falla
     */
    @PostMapping("/{id}/inventario/donacion")
    @Operation(summary = "Registrar la donacion de un insumo")
    public ResponseEntity<Object> donar(@PathVariable UUID id, @RequestBody DonacionRequest request) {
        try {
            if (request == null || request.itemId() == null) {
                throw new IllegalArgumentException("El insumo es obligatorio.");
            }
            if (request.cantidad() == null) {
                throw new IllegalArgumentException("La cantidad es obligatoria.");
            }
            DonacionAceptada aceptada = registrarDonacionUseCase.donar(id, request.itemId(), request.cantidad());
            return ResponseEntity.ok(DonacionResultadoDto.fromDomain(aceptada));
        } catch (CentroAcopioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("CENTRO_ACOPIO_NO_ENCONTRADO", MENSAJE_CENTRO_NO_ENCONTRADO));
        } catch (ItemInventarioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("ITEM_INVENTARIO_NO_ENCONTRADO", MENSAJE_ITEM_NO_ENCONTRADO));
        } catch (NecesidadCubiertaException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("NECESIDAD_CUBIERTA", MENSAJE_NECESIDAD_CUBIERTA));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_INVALIDOS));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_REGISTRO_DONACION", MENSAJE_ERROR_DONACION));
        }
    }

    /**
     * Despacha stock del item indicado: descuenta la cantidad elegida con un
     * CAS atómico (C1). La solicitud entra al proceso de asignación —el stock
     * se reserva de inmediato— y se rechaza con 409 si no alcanza; el stock
     * nunca queda negativo. El servicio publica el semáforo actualizado en
     * {@code /topic/suministros} después del commit.
     *
     * <p>El orden de los {@code catch} importa: los "no encontrado" (404) caen
     * antes que {@link StockInsuficienteException} (409), esta antes que
     * {@link IllegalArgumentException} (400) y esta antes de la genérica (500).
     *
     * @return 200 con el {@code ItemInventarioDto} descontado; 404
     *         {@code CENTRO_ACOPIO_NO_ENCONTRADO} si no existe el centro; 404
     *         {@code ITEM_INVENTARIO_NO_ENCONTRADO} si el item no existe en ese
     *         centro; 409 {@code STOCK_INSUFICIENTE} si el stock no alcanza; 400
     *         {@code DATOS_INVALIDOS} si falta el item o la cantidad no es un
     *         entero positivo; 500 {@code ERROR_DESPACHO} si el despacho falla
     */
    @PostMapping("/{id}/inventario/despacho")
    @Operation(summary = "Despachar un insumo con descuento atomico (C1)")
    public ResponseEntity<Object> despachar(@PathVariable UUID id, @RequestBody DespachoRequest request) {
        if (!puedeRetirarDe(id)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ErrorResponse.of("NO_ES_DUENO_DEL_CENTRO", MENSAJE_NO_ES_DUENO));
        }
        try {
            if (request == null || request.itemId() == null) {
                throw new IllegalArgumentException("El insumo es obligatorio.");
            }
            if (request.cantidad() == null) {
                throw new IllegalArgumentException("La cantidad es obligatoria.");
            }
            ItemInventario despachado = despacharStockUseCase.despachar(id, request.itemId(), request.cantidad());
            return ResponseEntity.ok(ItemInventarioDto.fromDomain(despachado));
        } catch (CentroAcopioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("CENTRO_ACOPIO_NO_ENCONTRADO", MENSAJE_CENTRO_NO_ENCONTRADO));
        } catch (ItemInventarioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("ITEM_INVENTARIO_NO_ENCONTRADO", MENSAJE_ITEM_NO_ENCONTRADO));
        } catch (StockInsuficienteException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.of("STOCK_INSUFICIENTE", MENSAJE_STOCK_INSUFICIENTE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_DESPACHO));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_DESPACHO", MENSAJE_ERROR_DESPACHO));
        }
    }

    /**
     * Regla del retiro: el administrador de la plataforma retira de cualquier
     * centro; los administradores de centro de ayuda y de acopio solo del suyo.
     * La cadena de seguridad ya dejó pasar únicamente a esos tres roles.
     */
    private boolean puedeRetirarDe(UUID centroId) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        boolean administrador = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(rol -> rol.equals("ROLE_ADMIN_PLATAFORMA"));
        if (administrador) {
            return true;
        }
        Usuario usuario = (Usuario) authentication.getPrincipal();
        return centroPropioPort.buscarPorAdmin(usuario.getId())
                .map(centro -> centro.id().equals(centroId))
                .orElse(false);
    }
}
