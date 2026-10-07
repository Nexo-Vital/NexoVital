package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AmbulanciaJpaRepository extends JpaRepository<AmbulanciaJpaEntity, UUID> {

    Optional<AmbulanciaJpaEntity> findByPlaca(String placa);

    List<AmbulanciaJpaEntity> findByEstado(EstadoAmbulancia estado);

    /**
     * CAS real del estado de la unidad: UNA sola {@code UPDATE} condicionada a
     * que la fila siga en {@code estadoEsperado}. Devuelve filas afectadas: 1 =
     * un solo ganador aplicó el cambio, 0 = la unidad ya se movió (otra misión
     * la ocupó, o ya fue liberada).
     *
     * <p>El {@code WHERE a.estado = :estadoEsperado} convierte el check-and-set
     * en atómico: dos accepts concurrentes sobre la MISMA unidad no pueden ganar
     * ambos. Sin esto, el read-modify-write dejaba al perdedor con la excepción
     * de {@code @Version}, que el cliente veía como un 500 en vez del 409 del
     * contrato.
     *
     * <p>{@code clearAutomatically} descarta la entidad cacheada, de modo que
     * una lectura posterior vea el estado ya persistido.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AmbulanciaJpaEntity a SET a.estado = :nuevoEstado, a.version = a.version + 1 "
            + "WHERE a.id = :id AND a.estado = :estadoEsperado")
    int transicionAtomicaEstado(@Param("id") UUID id,
                                @Param("estadoEsperado") EstadoAmbulancia estadoEsperado,
                                @Param("nuevoEstado") EstadoAmbulancia nuevoEstado);

    /**
     * The unit driven by a user. {@code findFirst} because the invariant is one
     * unit per driver (D-F6): a driver with several rows is a data anomaly and
     * must not turn the read into a 500.
     */
    Optional<AmbulanciaJpaEntity> findFirstByConductorId(UUID conductorId);

    /**
     * Position report: updates the position columns, stamps the report instant
     * and its source, clears {@code sinSenal} and bumps {@code @Version}, all in
     * ONE statement. It never writes {@code estado}, so a position report cannot
     * change the operational state (D-T5): the invariant is guaranteed by the
     * UPDATE itself.
     *
     * <p>{@code clearAutomatically} discards the cached entity so a later read
     * sees the persisted row.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AmbulanciaJpaEntity a SET a.lat = :lat, a.lng = :lng, "
            + "a.ultimaPosicionEn = :ahora, a.fuentePosicion = :fuente, a.sinSenal = false, "
            + "a.version = a.version + 1 "
            + "WHERE a.id = :id")
    int actualizarPosicionAtomica(@Param("id") UUID id,
                                  @Param("lat") double lat,
                                  @Param("lng") double lng,
                                  @Param("fuente") FuentePosicion fuente,
                                  @Param("ahora") Instant ahora);

    /**
     * Simulated position report (EP-04.F1.US1, D3): the same write as
     * {@link #actualizarPosicionAtomica}, CONDITIONED on the unit not being owned
     * by {@code fuenteQueManda} (the real device). A unit that never reported
     * (null source) is simulable.
     *
     * <p>The condition is in the WHERE, so it is evaluated by the database under
     * the row lock: a device report that commits between the simulator's read
     * and this statement makes it affect 0 rows.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AmbulanciaJpaEntity a SET a.lat = :lat, a.lng = :lng, "
            + "a.ultimaPosicionEn = :ahora, a.fuentePosicion = :fuente, a.sinSenal = false, "
            + "a.version = a.version + 1 "
            + "WHERE a.id = :id "
            + "AND (a.fuentePosicion IS NULL OR a.fuentePosicion <> :fuenteQueManda)")
    int actualizarPosicionSiNoLaTiene(@Param("id") UUID id,
                                      @Param("lat") double lat,
                                      @Param("lng") double lng,
                                      @Param("fuente") FuentePosicion fuente,
                                      @Param("ahora") Instant ahora,
                                      @Param("fuenteQueManda") FuentePosicion fuenteQueManda);

    /**
     * Units still counted as having signal whose last report is older than
     * {@code limite}. A null {@code ultimaPosicionEn} never matches, so a unit
     * that never reported is not a candidate.
     */
    List<AmbulanciaJpaEntity> findBySinSenalFalseAndUltimaPosicionEnBefore(Instant limite);

    /**
     * Marks ONE unit as "sin señal" only while it is not marked yet and its last
     * report is still older than {@code limite}. Returns rows affected: 1 = this
     * caller marked it, 0 = it reported again or another sweep marked it first.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE AmbulanciaJpaEntity a SET a.sinSenal = true, a.version = a.version + 1 "
            + "WHERE a.id = :id AND a.sinSenal = false AND a.ultimaPosicionEn < :limite")
    int marcarSinSenalAtomica(@Param("id") UUID id, @Param("limite") Instant limite);
}
