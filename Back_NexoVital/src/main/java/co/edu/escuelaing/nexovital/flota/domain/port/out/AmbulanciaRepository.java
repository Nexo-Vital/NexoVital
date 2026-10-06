package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Outbound port for the fleet aggregate. The domain never sees JPA. */
public interface AmbulanciaRepository {

    /**
     * Every available unit, with NO zone filter: the C2 broadcast reaches all of
     * them, so the zone is a map warning and never a dispatch key.
     */
    List<Ambulancia> listarDisponibles();

    Optional<Ambulancia> buscarPorId(UUID id);

    /**
     * The unit driven by {@code conductorId}, or empty when the driver has none.
     * It is the server-scoped way to resolve a driver's own unit (D-F6: one unit
     * per driver) for authorization reads such as the request detail
     * (EP-04.F2.US3): the caller's unit is looked up by identity and never
     * trusted from the client.
     */
    Optional<Ambulancia> buscarPorConductor(UUID conductorId);

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

    /**
     * Persists ONLY the position columns of a unit in one conditional-free
     * UPDATE and bumps {@code @Version}. It cannot touch {@code estado}, so the
     * "a report never changes the state" rule (D-T5) holds by construction, not
     * by discipline.
     *
     * <p>The read-modify-write via {@link #guardar(Ambulancia)} cannot be used
     * here: it builds a detached entity without the current version, so a second
     * report on the same row would detach at version 0 and clash with
     * {@code @Version}. The targeted UPDATE keeps the optimistic lock correct.
     *
     * @return rows affected: 1 = updated, 0 = the unit disappeared
     */
    int actualizarPosicionAtomica(UUID id, double lat, double lng);
}
