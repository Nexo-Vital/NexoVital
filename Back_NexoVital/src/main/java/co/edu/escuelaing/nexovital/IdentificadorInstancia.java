package co.edu.escuelaing.nexovital;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Identificador de esta instancia del back ({@code nexovital.instancia-id}).
 *
 * <p>Da nombre a la cola propia del fan-out de RabbitMQ y marca la bitácora y
 * las métricas. Si dos instancias tuvieran el mismo id compartirían la cola y
 * RabbitMQ repartiría los eventos entre ellas: cada cliente vería la mitad.
 *
 * <p>Con {@code NEXOVITAL_INSTANCIA_ID} (el compose fija {@code backend-1} y
 * {@code backend-2}) manda esa variable. Sin ella no basta el HOSTNAME: en el
 * entorno express de Azure Container Apps todas las réplicas tienen el mismo
 * ({@code adc-sandbox}). Por eso se le agrega un sufijo aleatorio, calculado UNA
 * vez al arrancar el proceso y publicado como propiedad del sistema: todas las
 * clases que leen {@code nexovital.instancia-id} ven el mismo valor.
 */
final class IdentificadorInstancia {

    static final String PROPIEDAD = "nexovital.instancia-id";
    static final String VARIABLE_EXPLICITA = "NEXOVITAL_INSTANCIA_ID";

    private IdentificadorInstancia() {
    }

    /**
     * Id generado para este proceso, o vacío si el entorno ya trae uno explícito.
     */
    static Optional<String> generado(Map<String, String> entorno) {
        String explicito = entorno.get(VARIABLE_EXPLICITA);
        if (explicito != null && !explicito.isBlank()) {
            return Optional.empty();
        }
        String host = entorno.get("HOSTNAME");
        String base = host == null || host.isBlank() ? "local" : host.trim();
        String sufijo = UUID.randomUUID().toString().substring(0, 8);
        return Optional.of(base + "-" + sufijo);
    }

    /** Fija el id generado como propiedad del sistema, si hace falta. */
    static void fijarSiFalta(Map<String, String> entorno) {
        if (System.getProperty(PROPIEDAD) == null) {
            generado(entorno).ifPresent(id -> System.setProperty(PROPIEDAD, id));
        }
    }
}
