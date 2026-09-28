package co.edu.escuelaing.nexovital.infrastructure.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.tags.Tag;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Metadata of the generated OpenAPI document (springdoc-openapi).
 *
 * <p>It only describes the API surface that actually exists in this backend:
 * the tags are the modules that own controllers. The document is served at
 * {@code /v3/api-docs} and rendered at {@code /swagger-ui/**}; the security
 * declaration for those paths lives in {@link SecurityConfig}.
 *
 * <p>The Bearer scheme is declared once here and applied to every operation by
 * default, so the "Authorize" button in Swagger UI works for the whole API.
 * {@code POST /api/v1/sesiones} is the single public operation and opts out
 * with {@code @SecurityRequirements}.
 */
@Configuration
public class OpenApiConfig {

    /** Name of the security scheme referenced by the operations. */
    private static final String ESQUEMA_BEARER = "bearerAuth";

    @Bean
    public OpenAPI nexovitalOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("Nexo Vital API")
                        .description("""
                                API HTTP de la sala de operaciones de emergencias CRUE (Nexo Vital).
                                Cubre identidad y organizaciones, mapa y emergencias, inventario de
                                centros de acopio y flota con solicitudes de ambulancia.
                                Los canales en tiempo real (WebSocket/STOMP) no forman parte de esta
                                documentacion: el contrato HTTP es el que se publica aqui.""")
                        .version("1.0.0")
                        .contact(new Contact().name("Equipo Nexo Vital - ARWS 2026-2 (ECI Colombia)")))
                .components(new Components()
                        .addSecuritySchemes(ESQUEMA_BEARER, new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("""
                                        Token JWT de sesion. Se obtiene en POST /api/v1/sesiones y se
                                        envia como 'Authorization: Bearer <token>'.""")))
                // Applied to every operation; the public login clears it.
                .addSecurityItem(new SecurityRequirement().addList(ESQUEMA_BEARER))
                .tags(List.of(
                        new Tag().name("usuarios")
                                .description("Sesiones, autenticacion y organizaciones (centros de ayuda y de acopio)."),
                        new Tag().name("mapa")
                                .description("Mapa en vivo y emergencias reportadas sobre las zonas."),
                        new Tag().name("recursos")
                                .description("Inventario de los centros de acopio: consulta, donacion y despacho (C1)."),
                        new Tag().name("flota")
                                .description("Flota de ambulancias y solicitudes: broadcast a la zona y primer accept gana (C2)."),
                        new Tag().name("observabilidad")
                                .description("Bitacora y monitoreo del sistema. Sin operaciones HTTP en este backend.")));
    }
}
