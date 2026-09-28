package co.edu.escuelaing.nexovital.shared.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Uniform {@code {codigo, mensaje}} envelope for the failures that happen BEFORE
 * a controller method runs, so the client never receives Spring's raw default
 * 400 body ({@code {timestamp, status, error, path}}).
 *
 * <p>Each controller catches its own domain exceptions with {@code try/catch},
 * but a body Jackson cannot deserialize (for example an {@code emergenciaId}
 * that is not a UUID, like {@code "EMG-002"}) is rejected while binding the
 * {@code @RequestBody} argument, so no {@code catch} inside the method can see
 * it: it bubbles to the exception resolver and, without this advice, the raw
 * default 400 is what the UI shows as "Error HTTP 400".
 *
 * <p>The envelope and the Spanish messages follow {@code SecurityConfig}
 * ({@code escribirError}) so every error the API emits has the same shape.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final String MENSAJE_CUERPO_ILEGIBLE =
            "El cuerpo de la solicitud no es válido: revise el formato de los datos enviados.";
    private static final String MENSAJE_DATOS_INVALIDOS =
            "Los datos enviados no son válidos: revise los campos obligatorios.";

    /**
     * A body Jackson cannot deserialize: malformed JSON, or a field whose shape
     * does not match the target type (the {@code UUID} case).
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> cuerpoIlegible(HttpMessageNotReadableException excepcion) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_CUERPO_ILEGIBLE));
    }

    /** A bean-validation failure on a body declared with {@code @Valid}. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> validacionFallida(MethodArgumentNotValidException excepcion) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("DATOS_INVALIDOS", MENSAJE_DATOS_INVALIDOS));
    }
}
