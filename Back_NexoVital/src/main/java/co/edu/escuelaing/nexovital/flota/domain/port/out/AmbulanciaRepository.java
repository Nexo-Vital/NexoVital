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
     * Candidates of a NEW request (EP-04.F2.US1, D5): every unit that is
     * {@code DISPONIBLE}, connected and has signal, read in ONE query. There is
     * NO zone and NO distance filter: the zone is a map warning and never a
     * dispatch key, and the search radius is out of the MVP.
     *
     * <p>The list is a snapshot of the instant of the query. A unit that
     * connects right after is not part of it; a unit that disconnects right
     * after stays in the list but can no longer accept
     * ({@link #ocuparAtomica(UUID)}).
     */
    List<Ambulancia> listarCandidatasParaSolicitud();

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

    /**
     * Connects ONE unit in a conditional UPDATE that only applies while it is
     * disconnected. It bumps {@code @Version}.
     *
     * @return rows affected: 1 = this caller connected it, 0 = it was already
     *         connected (or it disappeared)
     */
    int conectarAtomica(UUID id);

    /**
     * Disconnects ONE unit in a conditional UPDATE that only applies while it is
     * connected and NOT in service ({@code EN_MISION} or {@code EN_RUTA}). It
     * bumps {@code @Version}.
     *
     * <p>The condition lives in the UPDATE on purpose. A check in memory would
     * let an accept commit between the read and the write, leaving a unit in a
     * mission and disconnected. With the condition in the database the two
     * statements compete for the row lock and only one of them applies.
     *
     * @return rows affected: 1 = this caller disconnected it, 0 = it was already
     *         disconnected or it is in service
     */
    int desconectarAtomica(UUID id);

    /**
     * Occupies ONE unit for a mission: a conditional UPDATE from
     * {@code DISPONIBLE} to {@code EN_MISION} that only applies while the unit
     * is connected. It bumps {@code @Version}.
     *
     * @return rows affected: 1 = this caller occupied it, 0 = the unit was no
     *         longer available or its driver disconnected first
     */
    int ocuparAtomica(UUID id);
}
