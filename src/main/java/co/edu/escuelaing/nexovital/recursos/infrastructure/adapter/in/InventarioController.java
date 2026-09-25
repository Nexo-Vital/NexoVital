package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarInventarioUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarDonacionUseCase;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.DonacionRequest;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
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
public class InventarioController {

    private static final String MENSAJE_CENTRO_NO_ENCONTRADO =
            "No existe un centro de acopio con el identificador indicado.";
    private static final String MENSAJE_ERROR_CONSULTA = "No fue posible consultar el inventario.";
    private static final String MENSAJE_ITEM_NO_ENCONTRADO =
            "No existe el insumo indicado en el centro de acopio.";
    private static final String MENSAJE_DATOS_INVALIDOS =
            "La donación no es válida: revise el insumo y la cantidad.";
    private static final String MENSAJE_ERROR_DONACION = "No fue posible registrar la donación.";

    private final ConsultarInventarioUseCase consultarInventarioUseCase;
    private final RegistrarDonacionUseCase registrarDonacionUseCase;

    public InventarioController(ConsultarInventarioUseCase consultarInventarioUseCase,
                                RegistrarDonacionUseCase registrarDonacionUseCase) {
        this.consultarInventarioUseCase = consultarInventarioUseCase;
        this.registrarDonacionUseCase = registrarDonacionUseCase;
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
     * Registra una donación: acredita stock al item indicado, en la cantidad
     * elegida. El crédito es inmediato y sin tope (no se recorta al
     * {@code requerido}), y lo aplica el servicio de forma atómica dentro de su
     * transacción; el controlador nunca es el disparador del push.
     *
     * <p>El orden de los {@code catch} importa: las excepciones de "no
     * encontrado" (404) caen antes que {@link IllegalArgumentException} (400), y
     * esta antes que la genérica (500).
     *
     * @return 200 con el {@code ItemInventarioDto} acreditado; 404
     *         {@code CENTRO_ACOPIO_NO_ENCONTRADO} si no existe el centro; 404
     *         {@code ITEM_INVENTARIO_NO_ENCONTRADO} si el item no existe en ese
     *         centro; 400 {@code DATOS_INVALIDOS} si falta el item o la cantidad
     *         no es un entero positivo; 500 {@code ERROR_REGISTRO_DONACION} si el
     *         registro falla
     */
    @PostMapping("/{id}/inventario/donacion")
    public ResponseEntity<Object> donar(@PathVariable UUID id, @RequestBody DonacionRequest request) {
        try {
            if (request == null || request.itemId() == null) {
                throw new IllegalArgumentException("El insumo es obligatorio.");
            }
            if (request.cantidad() == null) {
                throw new IllegalArgumentException("La cantidad es obligatoria.");
            }
            ItemInventario acreditado = registrarDonacionUseCase.donar(id, request.itemId(), request.cantidad());
            return ResponseEntity.ok(ItemInventarioDto.fromDomain(acreditado));
        } catch (CentroAcopioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("CENTRO_ACOPIO_NO_ENCONTRADO", MENSAJE_CENTRO_NO_ENCONTRADO));
        } catch (ItemInventarioNoEncontradoException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("ITEM_INVENTARIO_NO_ENCONTRADO", MENSAJE_ITEM_NO_ENCONTRADO));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_INVALIDOS));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError()
                    .body(ErrorResponse.of("ERROR_REGISTRO_DONACION", MENSAJE_ERROR_DONACION));
        }
    }
}
