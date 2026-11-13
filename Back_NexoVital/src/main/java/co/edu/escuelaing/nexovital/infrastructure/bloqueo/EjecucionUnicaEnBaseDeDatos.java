package co.edu.escuelaing.nexovital.infrastructure.bloqueo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * Bloqueo distribuido sobre una fila de base de datos.
 *
 * <p>El dueño se identifica con un UUID generado al arrancar el proceso, no con
 * {@code NEXOVITAL_INSTANCIA_ID}: si dos nodos se configuraran con el mismo
 * identificador, ambos se creerían dueños del bloqueo y no habría exclusión.
 *
 * <p>El primer ciclo de cada tarea inserta la fila. Si dos instancias insertan a
 * la vez, una choca contra la clave primaria: esa pierde y la otra gana, que es
 * exactamente lo que se busca. Por eso el método no es transaccional de punta a
 * punta: cada sentencia commitea sola y el choque no envenena la transacción.
 */
@Component
public class EjecucionUnicaEnBaseDeDatos implements EjecucionUnica {

    private static final Logger LOG = LoggerFactory.getLogger(EjecucionUnicaEnBaseDeDatos.class);

    private final BloqueoEjecucionJpaRepository repositorio;
    private final String propietario = UUID.randomUUID().toString();

    public EjecucionUnicaEnBaseDeDatos(BloqueoEjecucionJpaRepository repositorio) {
        this.repositorio = repositorio;
    }

    @Override
    public boolean intentar(String nombre, Duration vigencia) {
        Instant ahora = Instant.now();
        Instant expiraEn = ahora.plus(vigencia);

        if (repositorio.tomar(nombre, propietario, expiraEn, ahora) == 1) {
            return true;
        }

        try {
            repositorio.saveAndFlush(new BloqueoEjecucionJpaEntity(nombre, propietario, expiraEn));
            return true;
        } catch (DataIntegrityViolationException e) {
            // Otra instancia insertó primero: se reintenta el UPDATE por si su
            // bloqueo ya venció en el intervalo.
            LOG.debug("Bloqueo '{}' ya creado por otra instancia", nombre);
            return repositorio.tomar(nombre, propietario, expiraEn, Instant.now()) == 1;
        }
    }
}
