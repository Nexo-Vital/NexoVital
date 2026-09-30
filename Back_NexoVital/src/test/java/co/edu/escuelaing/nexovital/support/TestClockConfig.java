package co.edu.escuelaing.nexovital.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Test clock configuration (design D8).
 *
 * <p>The production {@code ClockConfig} already publishes a {@link java.time.Clock}
 * bean. This adds a {@link MutableClock} bean marked {@code @Primary} so it wins
 * at the injection points ({@code AuthenticationUseCaseImpl} and
 * {@code JwtTokenAdapter}) without disabling the production configuration.
 */
@TestConfiguration
public class TestClockConfig {

    /**
     * Frozen base instant of the clock. It is "now", truncated to the second,
     * and not a hardcoded date: JJWT validates token expiration ({@code exp})
     * against the system clock, not against the injected
     * {@link java.time.Clock}. A token issued with a clock fixed in the past
     * would be read as expired and T7 would fail for a reason that is not the
     * production code's fault.
     *
     * <p>What matters for T3 and T4 is that, from this instant on, the clock
     * <b>does not advance on its own</b>: each test resets it in
     * {@code @BeforeEach} and only moves it with {@link MutableClock#avanzar},
     * so the 5-minute windows are verified by controlled deltas and do not
     * depend on how long the suite takes.
     */
    public static final Instant INSTANTE_BASE = Instant.now().truncatedTo(ChronoUnit.SECONDS);

    @Bean
    @Primary
    public MutableClock mutableClock() {
        return new MutableClock(INSTANTE_BASE);
    }
}
