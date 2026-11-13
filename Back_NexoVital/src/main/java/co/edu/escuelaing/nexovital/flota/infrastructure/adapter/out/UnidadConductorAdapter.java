package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.PlacaDuplicadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UnidadConductorPort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * Crea la ambulancia de un conductor que se registra con Google (T10).
 *
 * <p>La unicidad de la placa se cuida en dos pasos:
 * <ol>
 *   <li>Si ya hay una ambulancia con esa placa (las sembradas ABC101…ABC505 o
 *       una registrada antes), se rechaza de entrada.</li>
 *   <li>Para dos registros simultáneos con la misma placa, que pasarían los dos
 *       el paso 1, decide la clave primaria de {@code flota.placas}: el segundo
 *       INSERT falla y su transacción completa se deshace.</li>
 * </ol>
 *
 * <p>La unidad arranca en la posición base de la zona por defecto y
 * desconectada; su posición real llega cuando el conductor entra a su consola.
 */
@Component
public class UnidadConductorAdapter implements UnidadConductorPort {

    /** Posición inicial: la misma zona y el mismo sector que las unidades sembradas. */
    static final String ZONA_INICIAL = "Suba";
    static final double LAT_INICIAL = 4.735d;
    static final double LNG_INICIAL = -74.080d;

    private final AmbulanciaJpaRepository ambulanciaJpaRepository;
    private final PlacaRegistradaJpaRepository placaRegistradaJpaRepository;
    private final Clock clock;

    public UnidadConductorAdapter(AmbulanciaJpaRepository ambulanciaJpaRepository,
                                  PlacaRegistradaJpaRepository placaRegistradaJpaRepository,
                                  Clock clock) {
        this.ambulanciaJpaRepository = ambulanciaJpaRepository;
        this.placaRegistradaJpaRepository = placaRegistradaJpaRepository;
        this.clock = clock;
    }

    @Override
    public void registrarUnidad(UUID conductorId, String placa, String modelo) {
        if (ambulanciaJpaRepository.existsByPlacaIgnoreCase(placa)) {
            throw new PlacaDuplicadaException(placa);
        }
        UUID ambulanciaId = UUID.randomUUID();
        try {
            placaRegistradaJpaRepository.saveAndFlush(
                    new PlacaRegistradaJpaEntity(placa, ambulanciaId, Instant.now(clock)));
        } catch (DataIntegrityViolationException e) {
            throw new PlacaDuplicadaException(placa);
        }
        ambulanciaJpaRepository.saveAndFlush(AmbulanciaJpaEntity.deConductorRegistrado(
                ambulanciaId, placa, modelo, LAT_INICIAL, LNG_INICIAL, ZONA_INICIAL, conductorId));
    }
}
