package co.edu.escuelaing.nexovital.limites.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.limites.domain.port.out.ContadorSolicitudesPort;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/**
 * Adaptador del contador sobre la base de datos.
 *
 * <p>Tres caminos, en orden de probabilidad: la fila existe y la ventana sigue
 * (incrementar), la fila existe y la ventana venció (reiniciar), o la fila no
 * existe (insertar). El cuarto caso — dos instancias insertando la misma clave a
 * la vez — lo resuelve la clave primaria: la perdedora recibe una violación de
 * unicidad, reintenta el incremento y sigue. Nunca se pierde una solicitud del
 * conteo, que es justo lo que un atacante buscaría.
 */
@Component
public class ContadorSolicitudesAdapter implements ContadorSolicitudesPort {

    private final LimiteSolicitudJpaRepository repositorio;

    public ContadorSolicitudesAdapter(LimiteSolicitudJpaRepository repositorio) {
        this.repositorio = repositorio;
    }

    @Override
    public long registrar(String clave, Instant ahora, Duration ventana) {
        Instant ventanaHasta = ahora.plus(ventana);

        if (repositorio.incrementarSiVigente(clave, ahora) == 1) {
            return leerContador(clave);
        }
        if (repositorio.reiniciarSiVencida(clave, ahora, ventanaHasta) == 1) {
            return 1L;
        }
        try {
            repositorio.save(new LimiteSolicitudJpaEntity(clave, 1, ventanaHasta));
            return 1L;
        } catch (DataIntegrityViolationException carrera) {
            // Otra instancia insertó la misma clave entre el UPDATE y el INSERT.
            repositorio.incrementarSiVigente(clave, ahora);
            return leerContador(clave);
        }
    }

    private long leerContador(String clave) {
        return repositorio.findById(clave)
                .map(LimiteSolicitudJpaEntity::getContador)
                .map(Integer::longValue)
                .orElse(1L);
    }
}
