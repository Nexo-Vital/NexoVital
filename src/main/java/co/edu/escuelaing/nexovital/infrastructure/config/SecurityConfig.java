package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Stateless security with the {@code ROLE_<ROL>} authority.
 *
 * <p>The only public endpoint is {@code POST /api/v1/sesiones}: it issues the
 * token. Every protected operation is declared here explicitly; anything not
 * declared is denied (fail-closed), never left open to every authenticated
 * role.
 *
 * <p>{@link JwtAuthFilter} publishes the {@code ROLE_<ROL>} authority into the
 * security context from the presented token, so a per-role declaration only
 * has to name that authority; nothing new must be built to grant it.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /** Development frontend origin (Vite). */
    private static final List<String> ORIGENES_PERMITIDOS =
            List.of("http://localhost:5173", "http://127.0.0.1:5173");

    private final JwtAuthFilter jwtAuthFilter;
    private final ObjectMapper objectMapper;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter, ObjectMapper objectMapper) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.objectMapper = objectMapper;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.POST, "/api/v1/sesiones").permitAll()
                        // Spring Boot forwards unhandled failures to /error and that
                        // dispatch passes through this chain: without permission here, a
                        // validation 400 would turn into a 401.
                        .requestMatchers("/error").permitAll()
                        // WebSocket/STOMP handshake (US2 D7): the HTTP handshake carries no
                        // Bearer (the token travels in the STOMP CONNECT frame) and SockJS
                        // issues GET /ws/info over HTTP, so the handshake is permitted. This
                        // does NOT authenticate: StompAuthChannelInterceptor validates the
                        // CONNECT. The endpoint is registered with .withSockJS(), so it
                        // answers on the SockJS routes: "/ws/**" is what actually serves the
                        // handshake. "/ws" is declared too because the SockJS mapping also
                        // matches the bare path, and leaving it declared keeps this rule
                        // honest about every path the endpoint owns.
                        .requestMatchers("/ws", "/ws/**").permitAll()
                        // The caller's own session: every authenticated role may read it.
                        .requestMatchers(HttpMethod.GET, "/api/v1/sesiones/actual").authenticated()
                        // Read model of aid/acopio centers: the operations room consumes
                        // it, so every authenticated role may read it. Declared explicitly
                        // because the chain is fail-closed.
                        .requestMatchers(HttpMethod.GET, "/api/v1/organizaciones").authenticated()
                        // Read model of the map (zones + centers): same audience as the
                        // organizations list, every authenticated role may read it.
                        .requestMatchers(HttpMethod.GET, "/api/v1/mapa").authenticated()
                        // Report an emergency (US3): the citizen reports the affected
                        // zone. Azure fixes the role as CIUDADANO, so the matcher names
                        // only that authority. Declared explicitly because the chain is
                        // fail-closed; without it, POST /emergencias would be denied.
                        .requestMatchers(HttpMethod.POST, "/api/v1/emergencias").hasAuthority("ROLE_CIUDADANO")
                        // Read model of reported emergencies (US3 D7): a client that
                        // connects late reads the current state instead of relying on the
                        // realtime push, which does not replay. Same audience as GET
                        // /api/v1/mapa, so every authenticated role may read it. Declared
                        // explicitly because the chain is fail-closed; without it, GET
                        // /emergencias would be denied.
                        .requestMatchers(HttpMethod.GET, "/api/v1/emergencias").authenticated()
                        // Update an emergency (US4): the help-center administrator, the
                        // role the story fixes (D3). The matcher names only that
                        // authority. Declared explicitly because the chain is fail-closed;
                        // without it, PATCH /emergencias/{id} would be denied. The path
                        // carries the {id}, so the pattern covers the sub-paths.
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/emergencias/**")
                                .hasAuthority("ROLE_ADMIN_CENTRO_AYUDA")
                        // Register an organization/center (EP-01.F2.US1): the platform
                        // administrator creates it. Azure fixes the role as the platform
                        // administrator, so the matcher names only that authority. Declared
                        // explicitly because the chain is fail-closed; without it, POST
                        // /organizaciones would be denied.
                        .requestMatchers(HttpMethod.POST, "/api/v1/organizaciones")
                                .hasAuthority("ROLE_ADMIN_PLATAFORMA")
                        // Fail-closed standard: an operation that is not declared here is
                        // denied, never silently open to every authenticated role. A new
                        // operation must add its own declaration (matcher or
                        // @PreAuthorize) before it can be reached.
                        .anyRequest().denyAll())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, authException) ->
                                escribirError(response, HttpServletResponse.SC_UNAUTHORIZED,
                                        "NO_AUTENTICADO", "Token ausente, inválido o expirado"))
                        .accessDeniedHandler((request, response, deniedException) ->
                                escribirError(response, HttpServletResponse.SC_FORBIDDEN,
                                        "ACCESO_DENEGADO", "No tiene permisos para este recurso")))
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private void escribirError(HttpServletResponse response, int status, String codigo, String mensaje)
            throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        objectMapper.writeValue(response.getWriter(), ErrorResponse.of(codigo, mensaje));
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(ORIGENES_PERMITIDOS);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
