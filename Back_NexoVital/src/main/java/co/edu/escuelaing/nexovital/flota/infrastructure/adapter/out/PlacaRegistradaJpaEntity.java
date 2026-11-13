package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.springframework.data.domain.Persistable;

import java.time.Instant;
import java.util.UUID;

/**
 * Placa ya usada por un vehículo registrado (T10). Su único trabajo es que la
 * placa sea ÚNICA aunque dos conductores se registren a la vez.
 *
 * <p>{@code flota.ambulancias} no puede tener UNIQUE sobre la placa: Citus
 * exige que todo índice único incluya la columna de distribución ({@code id}).
 * Esta tabla tiene la placa como clave primaria y en Citus es una tabla de
 * referencia ({@code deploy/citus/distribuir.sql}), que sí admite clave única.
 * El registro inserta aquí y en {@code ambulancias} en la misma transacción: el
 * segundo conductor con la misma placa choca con la clave primaria y su
 * registro completo se deshace.
 *
 * <p>Implementa {@link Persistable} con {@code isNew() = true} para que Spring
 * Data haga siempre {@code persist} (INSERT) y nunca {@code merge}: con merge,
 * una placa repetida se convertiría en un UPDATE silencioso en vez de fallar.
 */
@Entity
@Table(name = "placas", schema = "flota")
public class PlacaRegistradaJpaEntity implements Persistable<String> {

    @Id
    @Column(length = 10)
    private String placa;

    @Column(name = "ambulancia_id", nullable = false)
    private UUID ambulanciaId;

    @Column(name = "registrada_en", nullable = false)
    private Instant registradaEn;

    protected PlacaRegistradaJpaEntity() {
    }

    public PlacaRegistradaJpaEntity(String placa, UUID ambulanciaId, Instant registradaEn) {
        this.placa = placa;
        this.ambulanciaId = ambulanciaId;
        this.registradaEn = registradaEn;
    }

    @Override
    public String getId() {
        return placa;
    }

    @Override
    public boolean isNew() {
        return true;
    }
}
