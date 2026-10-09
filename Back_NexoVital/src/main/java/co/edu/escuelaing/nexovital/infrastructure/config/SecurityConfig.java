package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
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
import java.util.Arrays;
import java.util.List;

/**
 * Stateless security with the {@code ROLE_<ROL>} authority.
 *
 * <p>The only public endpoint is {@code POST /api/v1/sesiones}: it issues the
 * token. Every protected operation is declared here explicitly; anything not
 * declared is denied (fail-closed), never left open to every authenticated
 * role.
 *
 * <p>The API documentation routes ({@link #RUTAS_SWAGGER}) are the one
 * additional exception, and only while {@code nexovital.swagger.enabled} is
 * true (dev/test). The {@code prod} profile sets it to false, so the docs are
 * not even declared there and remain denied.
 *
 * <p>{@link JwtAuthFilter} publishes the {@code ROLE_<ROL>} authority into the
 * security context from the presented token, so a per-role declaration only
 * has to name that authority; nothing new must be built to grant it.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /**
     * Origenes permitidos para CORS y el handshake WebSocket. Provienen de
     * {@code nexovital.origenes-permitidos} (lista separada por comas); el
     * default cubre el Vite de desarrollo.
     */
    private final List<String> origenesPermitidos;

    /**
     * Routes owned by springdoc-openapi: the OpenAPI JSON and the Swagger UI
     * assets. Kept as a named constant so the security declaration and the
     * prod note stay in one place.
     */
    private static final String[] RUTAS_SWAGGER = {
            "/v3/api-docs", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html"
    };

    private final JwtAuthFilter jwtAuthFilter;
    private final ObjectMapper objectMapper;

    /**
     * Roles that use the citizen screen: they may request an ambulance (and
     * confirm or cancel their own request) and report an affected zone. The
     * help-center administrator shares that screen, so it shares those actions;
     * the use cases still verify the caller is the request's own requester.
     */
    /**
     * Quién puede retirar stock de un centro (despacho): los administradores
     * de la plataforma y de acopio en cualquier centro, y el administrador de
     * centro de ayuda SOLO en el suyo (esa regla de dueño la aplica el
     * controlador, que conoce el centro de la ruta).
     */
    private static final String[] ROLES_RETIRO = {
            "ROLE_ADMIN_CENTRO_AYUDA", "ROLE_ADMIN_PLATAFORMA", "ROLE_ADMIN_ACOPIO"};

    /**
     * Administradores que gestionan SU centro (crear, ver, agregar insumos):
     * el de centro de ayuda y el de acopio hacen lo mismo.
     */
    private static final String[] ROLES_ADMIN_DE_CENTRO = {"ROLE_ADMIN_CENTRO_AYUDA", "ROLE_ADMIN_ACOPIO"};

    private static final String[] ROLES_SOLICITANTES =
            {"ROLE_CIUDADANO", "ROLE_ADMIN_CENTRO_AYUDA", "ROLE_ADMIN_ACOPIO"};

    /**
     * Whether the documentation routes are declared as public. It is true for
     * dev/test; the {@code prod} profile turns it off, so the routes fall
     * through to {@code anyRequest().denyAll()} and the docs are never exposed
     * in production.
     */
    private final boolean swaggerHabilitado;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter, ObjectMapper objectMapper,
                          @Value("${nexovital.swagger.enabled:true}") boolean swaggerHabilitado,
                          @Value("${nexovital.origenes-permitidos:http://localhost:5173,http://127.0.0.1:5173}")
                          String origenesPermitidosCsv) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.objectMapper = objectMapper;
        this.swaggerHabilitado = swaggerHabilitado;
        this.origenesPermitidos = Arrays.stream(origenesPermitidosCsv.split(","))
                .map(String::trim)
                .filter(origen -> !origen.isEmpty())
                .toList();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> {
                    auth
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
                        // zone. The help-center administrator's screen is the citizen
                        // map with one different action, so that role may report too.
                        // Declared explicitly because the chain is fail-closed; without
                        // it, POST /emergencias would be denied.
                        .requestMatchers(HttpMethod.POST, "/api/v1/emergencias")
                                .hasAnyAuthority(ROLES_SOLICITANTES)
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
                        // The help-center administrator's OWN center (EP-03.F1.US1):
                        // read it, create it with its supplies and declare a new
                        // supply. The center is resolved server-side from the caller,
                        // so only that role reaches these routes. Declared explicitly
                        // because the chain is fail-closed, and BEFORE the generic
                        // inventory matchers so "mio" is never read as a center id.
                        .requestMatchers(HttpMethod.GET, "/api/v1/centros-acopio/mio")
                                .hasAnyAuthority(ROLES_ADMIN_DE_CENTRO)
                        .requestMatchers(HttpMethod.POST, "/api/v1/centros-acopio/mio")
                                .hasAnyAuthority(ROLES_ADMIN_DE_CENTRO)
                        .requestMatchers(HttpMethod.POST, "/api/v1/centros-acopio/mio/inventario")
                                .hasAnyAuthority(ROLES_ADMIN_DE_CENTRO)
                        // Inventory of an aid center (EP-03.F1): the citizen sees
                        // the supplies of the center with their traffic light, so
                        // every authenticated role may read it. Declared explicitly
                        // because the chain is fail-closed; without it, GET
                        // /centros-acopio/{id}/inventario would be denied.
                        .requestMatchers(HttpMethod.GET, "/api/v1/centros-acopio/*/inventario").authenticated()
                        // Donación de un insumo (EP-03.F3): el ciudadano acredita
                        // stock al centro. Cualquier rol autenticado puede donar,
                        // sin restricción adicional. Declarado explícitamente
                        // porque la cadena es fail-closed; sin él, POST
                        // /centros-acopio/{id}/inventario/donacion se denegaría.
                        .requestMatchers(HttpMethod.POST, "/api/v1/centros-acopio/*/inventario/donacion")
                                .authenticated()
                        // Retiro de stock (despacho): solo administradores. El de centro
                        // de ayuda únicamente sobre su propio centro (lo valida el
                        // controlador); cualquier otro rol recibe 403. Declarado
                        // explícitamente porque la cadena es fail-closed.
                        .requestMatchers(HttpMethod.POST, "/api/v1/centros-acopio/*/inventario/despacho")
                                .hasAnyAuthority(ROLES_RETIRO)
                        // Fleet read model (EP-04): the operations room and the
                        // drivers need the fleet with position and state, so
                        // every authenticated role may read it. Declared
                        // explicitly because the chain is fail-closed; without
                        // it, GET /flota/ambulancias would be denied.
                        .requestMatchers(HttpMethod.GET, "/api/v1/flota/ambulancias").authenticated()
                        // The driver's OWN unit (EP-04, FIX3): the general fleet
                        // list no longer exposes any driver id, so only a driver
                        // may read the server-scoped resource. The server returns
                        // only the caller's unit. Declared explicitly because the
                        // chain is fail-closed.
                        .requestMatchers(HttpMethod.GET, "/api/v1/flota/ambulancias/mia")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // History of the caller's OWN unit (EP-04, CON-3): only a
                        // driver reads the services their ambulance actually
                        // attended. The controller resolves the same server-scoped
                        // unit as /mia. Declared explicitly because the chain is
                        // fail-closed.
                        .requestMatchers(HttpMethod.GET, "/api/v1/flota/ambulancias/mia/solicitudes")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Report the live position of the caller's OWN unit
                        // (EP-04.F1.US1): only a driver reports telemetry, and
                        // the use case additionally verifies the unit belongs to
                        // the caller (409 otherwise). Declared explicitly because
                        // the chain is fail-closed; without it, POST
                        // /flota/ambulancias/{id}/posicion would be denied.
                        .requestMatchers(HttpMethod.POST, "/api/v1/flota/ambulancias/*/posicion")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Connection of the caller's OWN unit (EP-04.F2.US1): only a
                        // driver connects or disconnects, and the server resolves
                        // the unit from the caller, so no unit id is sent. Declared
                        // explicitly because the chain is fail-closed.
                        .requestMatchers(HttpMethod.POST, "/api/v1/flota/ambulancias/mia/conectar")
                                .hasAuthority("ROLE_CONDUCTOR")
                        .requestMatchers(HttpMethod.POST, "/api/v1/flota/ambulancias/mia/desconectar")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Availability of the caller's OWN unit (EP-04.F2.US1): only a
                        // driver declares it available or out of service. Declared
                        // explicitly because the chain is fail-closed.
                        .requestMatchers(HttpMethod.POST, "/api/v1/flota/ambulancias/mia/disponibilidad")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Open requests the caller's OWN unit can still answer
                        // (EP-04.F2.US1): only a driver reads them. Declared
                        // explicitly because the chain is fail-closed.
                        .requestMatchers(HttpMethod.GET, "/api/v1/flota/ambulancias/mia/solicitudes/pendientes")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Request an ambulance (EP-04, broadcast C2): the
                        // citizen raises the request. The help-center
                        // administrator may request one too (same screen as the
                        // citizen). Declared explicitly because the chain is
                        // fail-closed; without it, POST /solicitudes would be denied.
                        .requestMatchers(HttpMethod.POST, "/api/v1/solicitudes")
                                .hasAnyAuthority(ROLES_SOLICITANTES)
                        // Accept a request (EP-04, C2): only the driver bids;
                        // the first accept wins the CAS server-side. Declared
                        // explicitly because the chain is fail-closed.
                        .requestMatchers(HttpMethod.POST, "/api/v1/solicitudes/*/accept")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Reject a request (EP-04, AC4): only the driver
                        // declines, and the request stays open for the rest.
                        // Declared explicitly because the chain is fail-closed.
                        .requestMatchers(HttpMethod.POST, "/api/v1/solicitudes/*/reject")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Declare arrival at the scene (EP-04): only the winning
                        // driver announces it. It is idempotent server-side.
                        // Declared explicitly because the chain is fail-closed.
                        .requestMatchers(HttpMethod.POST, "/api/v1/solicitudes/*/llegada")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Finish the service and release the unit (EP-04.F2.US6 /
                        // US11): only the assigned driver finishes; the server
                        // also verifies the unit is theirs and returns the unit
                        // to available. Declared explicitly because the chain is
                        // fail-closed; without it, /finalizar would be denied.
                        .requestMatchers(HttpMethod.POST, "/api/v1/solicitudes/*/finalizar")
                                .hasAuthority("ROLE_CONDUCTOR")
                        // Confirm the assigned unit (EP-04): the requester (the
                        // citizen who raised the request) closes the loop. The
                        // request's aid center is an organization id the principal
                        // cannot resolve, so the actor is the citizen and the use
                        // case additionally verifies the caller IS the request's
                        // own solicitanteId. Declared explicitly because the chain
                        // is fail-closed. The roles are the ones that may raise a
                        // request (ROLES_SOLICITANTES).
                        .requestMatchers(HttpMethod.POST, "/api/v1/solicitudes/*/confirmar")
                                .hasAnyAuthority(ROLES_SOLICITANTES)
                        // Cancel the requester's own open request (EP-04): only
                        // the citizen withdraws, and the use case additionally
                        // verifies the caller IS the request's own solicitanteId
                        // (403 otherwise). Declared explicitly because the chain
                        // is fail-closed; without it, /cancelar would be denied.
                        .requestMatchers(HttpMethod.POST, "/api/v1/solicitudes/*/cancelar")
                                .hasAnyAuthority(ROLES_SOLICITANTES);

                    // Swagger UI and the OpenAPI JSON. These routes must be
                    // declared explicitly: the chain is fail-closed, so without
                    // them the docs would answer 403 ACCESO_DENEGADO and look
                    // uninstalled. Gated by nexovital.swagger.enabled (default
                    // true for dev/test); the prod profile turns it off, so the
                    // paths are never public in production. The paths are the
                    // springdoc defaults: /v3/api-docs renders the JSON and
                    // /swagger-ui/** serves the UI assets (/swagger-ui.html just
                    // redirects into them).
                    if (swaggerHabilitado) {
                        auth.requestMatchers(RUTAS_SWAGGER).permitAll();
                    }

                    // Fail-closed standard: an operation that is not declared
                    // here is denied, never silently open to every authenticated
                    // role. A new operation must add its own declaration (matcher
                    // or @PreAuthorize) before it can be reached.
                    auth.anyRequest().denyAll();
                })
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
        config.setAllowedOrigins(origenesPermitidos);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
