package co.edu.escuelaing.nexovital.limites.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * Las dos sentencias que mueven el contador.
 *
 * <p>Cada una es un {@code UPDATE} condicional: la base decide si la fila aplica,
 * no Java. Es el mismo patrón que usa el conteo de intentos fallidos de login, y
 * la razón es la misma: con dos instancias, "leer, comparar y escribir" deja
 * pasar solicitudes de más.
 *
 * <p>Llevan {@code @Transactional} propio a propósito. Así cada intento es una
 * transacción corta e independiente, y un fallo de inserción por carrera no deja
 * la transacción del request marcada para rollback.
 */
public interface LimiteSolicitudJpaRepository extends JpaRepository<LimiteSolicitudJpaEntity, String> {

    /** Incrementa solo si la ventana sigue viva. Devuelve 1 si tocó la fila. */
    @Modifying
    @Transactional
    @Query("update LimiteSolicitudJpaEntity l set l.contador = l.contador + 1 "
            + "where l.clave = :clave and l.ventanaHasta > :ahora")
    int incrementarSiVigente(@Param("clave") String clave, @Param("ahora") Instant ahora);

    /** Reinicia a 1 solo si la ventana ya venció. Devuelve 1 si tocó la fila. */
    @Modifying
    @Transactional
    @Query("update LimiteSolicitudJpaEntity l set l.contador = 1, l.ventanaHasta = :ventanaHasta "
            + "where l.clave = :clave and l.ventanaHasta <= :ahora")
    int reiniciarSiVencida(@Param("clave") String clave,
                           @Param("ahora") Instant ahora,
                           @Param("ventanaHasta") Instant ventanaHasta);
}
