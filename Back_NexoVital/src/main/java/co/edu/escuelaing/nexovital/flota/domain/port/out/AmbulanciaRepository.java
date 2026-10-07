package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.time.Instant;
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
     * Persists a position report in ONE unconditional UPDATE: the coordinates,
     * the report instant, its source, {@code sinSenal = false} (a unit that
     * reports has signal again) and the {@code @Version} bump. It cannot touch
     * {@code estado}, so the "a report never changes the state" rule (D-T5)
     * holds by construction, not by discipline.
     *
     * <p>The read-modify-write via {@link #guardar(Ambulancia)} cannot be used
     * here: it builds a detached entity without the current version, so a second
     * report on the same row would detach at version 0 and clash with
     * {@code @Version}. The targeted UPDATE keeps the optimistic lock correct.
     *
     * @param fuente who produced the report
     * @param ahora instant of the report
     * @return rows affected: 1 = updated, 0 = the unit disappeared
     */
    int actualizarPosicionAtomica(UUID id, double lat, double lng, FuentePosicion fuente, Instant ahora);

    /**
     * Same write as {@link #actualizarPosicionAtomica}, for the simulator, and
     * CONDITIONED on the unit not being claimed by a real device (EP-04.F1.US1,
     * D3): the UPDATE only applies while the last source is not
     * {@link FuentePosicion#DEVICE}.
     *
     * <p>The condition lives in the UPDATE on purpose. The simulator reads the
     * fleet first and writes afterwards; a device can report in between, and a
     * check in memory would let the simulator overwrite the real position. With
     * the condition in the database that write affects 0 rows.
     *
     * @return rows affected: 1 = moved, 0 = a device owns the unit (or it
     *         disappeared)
     */
    int actualizarPosicionSimuladaAtomica(UUID id, double lat, double lng, Instant ahora);

    /**
     * Units that still count as having signal but whose last report is older
     * than {@code limite}. A unit that never reported is not included: "lost
     * signal" means it had one.
     */
    List<Ambulancia> listarConSenalVencida(Instant limite);

    /**
     * Marks ONE unit as having lost its signal, in a conditional UPDATE: it only
     * applies while the unit is not marked yet and its last report is still
     * older than {@code limite}. It bumps {@code @Version}.
     *
     * <p>Two concurrent sweeps cannot both win, and a report that lands at the
     * same moment competes for the row lock: if the report wins, this affects 0
     * rows.
     *
     * @return rows affected: 1 = this caller marked it, 0 = it reported again or
     *         another sweep marked it first
     */
    int marcarSinSenalAtomica(UUID id, Instant limite);
}
