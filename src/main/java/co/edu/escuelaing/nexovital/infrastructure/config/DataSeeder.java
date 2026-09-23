package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.ZonaRepository;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.OrganizacionRepository;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Siembra el catálogo de usuarios y organizaciones precargados de demostración
 * (diseño D2).
 *
 * <p>Dos barreras para que NUNCA corra en producción (diseño D3):
 * <ol>
 *   <li>{@code @Profile({"default", "docker", "test"})}: el perfil {@code prod}
 *       excluye el bean.</li>
 *   <li>{@code @ConditionalOnProperty(nexovital.seed.enabled=true)}: exige opt-in
 *       explícito, de modo que un despliegue que herede la configuración local
 *       tampoco lo active.</li>
 * </ol>
 *
 * <p>Idempotente (T8): cada usuario se inserta solo si su email no existe y
 * cada organización solo si su nombre no existe, así que reiniciar la
 * aplicación no duplica filas ni falla.
 *
 * <p>El log registra únicamente el email. La contraseña demo nunca se escribe
 * en el log ni en la base: se persiste solo como hash BCrypt.
 */
@Component
@Profile({"default", "docker", "test"})
@ConditionalOnProperty(name = "nexovital.seed.enabled", havingValue = "true")
public class DataSeeder implements CommandLineRunner {

    private static final Logger LOG = LoggerFactory.getLogger(DataSeeder.class);

    private static final String PASSWORD_CONDUCTOR = "conductor123";

    private record UsuarioSemilla(String nombre, String email, String password, RolUsuario rol) {
    }

    private record OrganizacionSemilla(String nombre, TipoOrganizacion tipo, String zonaId, double lat, double lng) {
    }

    private record ZonaSemilla(String id, String nombre, double lat, double lng) {
    }

    /**
     * Los 10 usuarios de demostración que cubren los 5 roles canónicos.
     * Un conductor por ambulancia para poder probar el broadcast de C2.
     */
    private static final List<UsuarioSemilla> CATALOGO = List.of(
            new UsuarioSemilla("Rangel Dev", "rangel@nexovital.co", "rangel123", RolUsuario.ADMIN_CENTRO_AYUDA),
            new UsuarioSemilla("Admin Plataforma", "admin@nexovital.co", "admin123", RolUsuario.ADMIN_PLATAFORMA),
            new UsuarioSemilla("Coordinación CRUE", "centro@nexovital.co", "centro123", RolUsuario.ADMIN_CENTRO_AYUDA),
            new UsuarioSemilla("Admin Acopio Bogotá", "acopio@nexovital.co", "acopio123", RolUsuario.ADMIN_ACOPIO),
            new UsuarioSemilla("Ciudadano Demo", "ciudadano@nexovital.co", "ciudadano123", RolUsuario.CIUDADANO),
            new UsuarioSemilla("Conductor ABC101", "conductor1@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC202", "conductor2@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC303", "conductor3@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC404", "conductor4@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC505", "conductor5@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR));

    /**
     * Los 3 centros de Bogotá que el front usa hoy. Los nombres y las
     * coordenadas se reutilizan literales de los fixtures del front
     * ({@code Front_NexoVital/src/mocks/fixtures.ts}, {@code MOCK_CENTROS_AYUDA})
     * para que la versión con backend pinte los mismos centros. {@code zonaId}
     * es la localidad de Bogotá donde están los tres (Suba); la zona es
     * propiedad del módulo {@code mapa}, aquí es una referencia simple.
     */
    private static final List<OrganizacionSemilla> CATALOGO_ORGANIZACIONES = List.of(
            new OrganizacionSemilla("Acopio Suba Norte", TipoOrganizacion.CENTRO_ACOPIO, "Suba", 4.742d, -74.09d),
            new OrganizacionSemilla("Acopio La Gaitana", TipoOrganizacion.CENTRO_ACOPIO, "Suba", 4.72d, -74.05d),
            new OrganizacionSemilla("Acopio Tibabuyes", TipoOrganizacion.CENTRO_ACOPIO, "Suba", 4.73d, -74.1d));

    /**
     * Las zonas de Bogotá que el front ya usa como {@code zonaId} en sus
     * fixtures ({@code Front_NexoVital/src/mocks/fixtures.ts}: ambulancias y
     * emergencias). Los ids coinciden literalmente con esos {@code zonaId};
     * {@code Suba} es la zona que referencia la semilla de organizaciones, así
     * que el mapa siempre tiene la zona de sus centros. Las coordenadas son el
     * punto representativo de la zona, reutilizado de los mismos fixtures (la
     * zona se modela como un punto, no un polígono: H2 sin PostGIS).
     */
    private static final List<ZonaSemilla> CATALOGO_ZONAS = List.of(
            new ZonaSemilla("Suba", "Suba", 4.73d, -74.08d),
            new ZonaSemilla("Usaquén", "Usaquén", 4.701d, -74.041d),
            new ZonaSemilla("Engativá", "Engativá", 4.692d, -74.112d),
            new ZonaSemilla("Kennedy", "Kennedy", 4.628d, -74.144d),
            new ZonaSemilla("Bosa", "Bosa", 4.608d, -74.186d),
            new ZonaSemilla("Centro", "Centro", 4.598d, -74.075d));

    private final UsuarioRepository usuarioRepository;
    private final OrganizacionRepository organizacionRepository;
    private final ZonaRepository zonaRepository;
    private final PasswordEncoderPort passwordEncoderPort;

    public DataSeeder(UsuarioRepository usuarioRepository,
                      OrganizacionRepository organizacionRepository,
                      ZonaRepository zonaRepository,
                      PasswordEncoderPort passwordEncoderPort) {
        this.usuarioRepository = usuarioRepository;
        this.organizacionRepository = organizacionRepository;
        this.zonaRepository = zonaRepository;
        this.passwordEncoderPort = passwordEncoderPort;
    }

    @Override
    public void run(String... args) {
        sembrarUsuarios();
        sembrarOrganizaciones();
        sembrarZonas();
    }

    private void sembrarUsuarios() {
        int sembrados = 0;
        for (UsuarioSemilla semilla : CATALOGO) {
            if (usuarioRepository.existePorEmail(semilla.email())) {
                LOG.info("Usuario demo ya existe, seed omitido: {}", semilla.email());
                continue;
            }
            usuarioRepository.guardar(new Usuario(
                    UUID.randomUUID(),
                    semilla.nombre(),
                    semilla.email(),
                    passwordEncoderPort.encriptar(semilla.password()),
                    semilla.rol()));
            sembrados++;
            LOG.info("Usuario demo sembrado: {} (rol {})", semilla.email(), semilla.rol());
        }
        LOG.info("Seed de usuarios demo finalizado: {} nuevos de {} en el catálogo", sembrados, CATALOGO.size());
    }

    /**
     * Idempotente por nombre: un centro que ya existe no se vuelve a insertar,
     * así que reiniciar la aplicación no duplica organizaciones ni falla.
     */
    private void sembrarOrganizaciones() {
        int sembrados = 0;
        for (OrganizacionSemilla semilla : CATALOGO_ORGANIZACIONES) {
            if (organizacionRepository.existePorNombre(semilla.nombre())) {
                LOG.info("Organización demo ya existe, seed omitido: {}", semilla.nombre());
                continue;
            }
            organizacionRepository.guardar(new Organizacion(
                    UUID.randomUUID(),
                    semilla.nombre(),
                    semilla.tipo(),
                    semilla.zonaId(),
                    new Ubicacion(semilla.lat(), semilla.lng())));
            sembrados++;
            LOG.info("Organización demo sembrada: {} ({})", semilla.nombre(), semilla.tipo());
        }
        LOG.info("Seed de organizaciones demo finalizado: {} nuevas de {} en el catálogo",
                sembrados, CATALOGO_ORGANIZACIONES.size());
    }

    /**
     * Idempotente por id: una zona que ya existe no se vuelve a insertar, así
     * que reiniciar la aplicación no duplica zonas ni falla.
     */
    private void sembrarZonas() {
        int sembradas = 0;
        for (ZonaSemilla semilla : CATALOGO_ZONAS) {
            if (zonaRepository.existePorId(semilla.id())) {
                LOG.info("Zona demo ya existe, seed omitido: {}", semilla.id());
                continue;
            }
            zonaRepository.guardar(new Zona(
                    semilla.id(),
                    semilla.nombre(),
                    new Ubicacion(semilla.lat(), semilla.lng())));
            sembradas++;
            LOG.info("Zona demo sembrada: {}", semilla.id());
        }
        LOG.info("Seed de zonas demo finalizado: {} nuevas de {} en el catálogo",
                sembradas, CATALOGO_ZONAS.size());
    }
}
