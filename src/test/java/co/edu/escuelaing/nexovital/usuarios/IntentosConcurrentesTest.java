package co.edu.escuelaing.nexovital.usuarios;

import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.application.usecase.AuthenticationUseCaseImpl;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CuentaBloqueadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.CredencialesLogin;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.AuthenticationUseCase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Case T6 of design §7: <b>concurrent</b> failed attempts on the same account.
 *
 * <p>This case is exercised with real threads against the real database. A
 * sequential test proves nothing about the race between the state read in Java
 * and the atomic {@code UPDATE} (D6): the race must be forced.
 *
 * <p>Invariants asserted (design §4.2 and §D6):
 * <ol>
 *   <li>{@code 0 <= intentos_fallidos <= 3}: never incremented above the
 *       maximum because, on reaching 3, the next attempt must be rejected
 *       without counting.</li>
 *   <li>{@code bloqueado_hasta IS NOT NULL} implies {@code intentos_fallidos = 3}.</li>
 *   <li>The counter does not lose increments below the threshold, and the block
 *       is never set before the third failure.</li>
 * </ol>
 *
 * <p>The barrier is placed right before entering the use case, so the threads
 * read the account state at almost the same time. That is exactly the scenario
 * design D6 must withstand.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class IntentosConcurrentesTest extends LoginTestBase {

    private static final String CUENTA = "acopio@nexovital.co";
    private static final String PASSWORD_INCORRECTA = "contrasena-incorrecta";

    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private AuthenticationUseCase authenticationUseCase;

    // -----------------------------------------------------------------------
    // T6 (a): below the threshold no increments are lost and no block fires
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T6a - 2 concurrent failures: the counter reaches 2 and the block does not fire before the third")
    void t6a_dosFallosConcurrentes_noPierdenIncrementos_yNoBloqueanAntesDelTercero() throws Exception {
        List<Throwable> resultados = ejecutarFallosConcurrentes(2);

        assertTrue(resultados.stream().allMatch(CredencialesInvalidasException.class::isInstance),
                "two concurrent failures below the threshold must return 401, observed: " + describir(resultados));
        assertEquals(2, intentosDe(CUENTA),
                "the counter must not lose increments: 2 registered failures were expected");
        assertNull(bloqueadoHastaDe(CUENTA),
                "the block must not be set before the third failure");
    }

    // -----------------------------------------------------------------------
    // T6 (b): above the threshold the counter must not exceed 3
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("T6b - 5 concurrent failures: the counter must not exceed 3 and the account ends up blocked")
    void t6b_cincoFallosConcurrentes_elContadorNoSuperaElMaximo() throws Exception {
        List<Throwable> resultados = ejecutarFallosConcurrentes(5);
        int intentosObservados = intentosDe(CUENTA);
        Instant bloqueoObservado = bloqueadoHastaDe(CUENTA);

        assertTrue(resultados.stream().noneMatch(Objects::isNull),
                "every attempt with a wrong password must fail");
        assertTrue(resultados.stream().noneMatch(t ->
                        !(t instanceof CredencialesInvalidasException) && !(t instanceof CuentaBloqueadaException)),
                "only 401 or 423 are allowed; got: " + describir(resultados));
        assertTrue(resultados.stream().anyMatch(CuentaBloqueadaException.class::isInstance),
                "with 5 concurrent failures there must be at least one 423");

        assertAll(
                () -> assertTrue(intentosObservados <= AuthenticationUseCaseImpl.MAX_INTENTOS_FALLIDOS,
                        "invariant 1 violated (0 <= intentos_fallidos <= 3): observed intentos_fallidos = "
                                + intentosObservados + " with 5 concurrent attempts"),
                () -> assertEquals(AuthenticationUseCaseImpl.MAX_INTENTOS_FALLIDOS, intentosObservados,
                        "the counter must end exactly at 3 and not once per thread: observed intentos_fallidos = "
                                + intentosObservados),
                () -> assertNotNull(bloqueoObservado,
                        "after reaching the maximum, the account must end up blocked"),
                () -> assertTrue(bloqueoObservado != null
                                && intentosObservados == AuthenticationUseCaseImpl.MAX_INTENTOS_FALLIDOS,
                        "invariant 2 violated (bloqueado_hasta != NULL implies intentos_fallidos = 3): observed intentos_fallidos = "
                                + intentosObservados + ", bloqueado_hasta = " + bloqueoObservado));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Fires {@code hilos} login attempts with a wrong password on the same
     * account and returns whatever each one threw. Threads line up on a barrier
     * immediately before entering the use case.
     */
    private List<Throwable> ejecutarFallosConcurrentes(int hilos) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(hilos);
        try {
            CyclicBarrier barrera = new CyclicBarrier(hilos);
            List<Future<Throwable>> futuros = new ArrayList<>();
            for (int i = 0; i < hilos; i++) {
                Callable<Throwable> intento = () -> {
                    barrera.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                    try {
                        authenticationUseCase.login(new CredencialesLogin(CUENTA, PASSWORD_INCORRECTA));
                        return new IllegalStateException(
                                "a login with a wrong password returned a session");
                    } catch (RuntimeException e) {
                        return e;
                    }
                };
                futuros.add(pool.submit(intento));
            }

            List<Throwable> resultados = new ArrayList<>();
            for (Future<Throwable> futuro : futuros) {
                try {
                    resultados.add(futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS));
                } catch (ExecutionException e) {
                    resultados.add(e.getCause());
                }
            }
            return resultados;
        } finally {
            pool.shutdownNow();
        }
    }

    private static String describir(List<Throwable> resultados) {
        return resultados.stream()
                .map(t -> t == null ? "null" : t.getClass().getSimpleName() + ": " + t.getMessage())
                .toList()
                .toString();
    }
}
