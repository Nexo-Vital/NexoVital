package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Outbound port for the fleet aggregate. The domain never sees JPA. */
public interface AmbulanciaRepository {

    List<Ambulancia> listarDisponiblesEnZona(String zona);

    Optional<Ambulancia> buscarPorId(UUID id);

    Ambulancia guardar(Ambulancia ambulancia);

    /**
     * Condición-atómica (CAS) del estado de la unidad: una sola UPDATE que solo
     * escribe si la fila sigue en {@code estadoEsperado}. Devuelve filas
     * afectadas: 1 = este llamador ganó el cambio, 0 = otro lo movió primero.
     *
     * <p>Reemplaza al read-modify-write que cargaba la entidad, la mutaba y la
     * guardaba: con dos accepts concurrentes sobre la MISMA unidad, ambos veían
     * {@code DISPONIBLE}, ambos escribían y el perdedor de {@code @Version}
     * terminaba en un 500 genérico. Con el CAS, el perdedor recibe 0 filas y el
     * caso de uso lo traduce al 409 de conflicto.
     */
    int transicionAtomicaEstado(UUID id, EstadoAmbulancia estadoEsperado, EstadoAmbulancia nuevoEstado);
}
