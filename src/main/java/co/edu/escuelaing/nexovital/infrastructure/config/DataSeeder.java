package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.ZonaRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
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

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

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

    private record ItemInventarioSemilla(String nombre, int disponible, int requerido, String unidad, String unitDetail) {
    }

    private record InventarioSemilla(String centroNombre, List<ItemInventarioSemilla> items) {
    }

    private record ZonaSemilla(String id, String nombre, double lat, double lng, List<Ubicacion> contorno) {
    }

    private record AmbulanciaSemilla(String placa, String emailConductor, String zona, double lat, double lng) {
    }

    /** Vértice del contorno de una zona, para leer el catálogo sin ruido. */
    private static Ubicacion vertice(double lat, double lng) {
        return new Ubicacion(lat, lng);
    }

    /**
     * Los 10 usuarios de demostración que cubren los 5 roles canónicos.
     * Un conductor por ambulancia para poder probar el broadcast de C2.
     */
    private static final List<UsuarioSemilla> CATALOGO = List.of(
            new UsuarioSemilla("Andrés Rangel", "rangel@nexovital.co", "rangel123", RolUsuario.ADMIN_CENTRO_AYUDA),
            new UsuarioSemilla("Diana Torres", "admin@nexovital.co", "admin123", RolUsuario.ADMIN_PLATAFORMA),
            new UsuarioSemilla("Camilo Rojas", "centro@nexovital.co", "centro123", RolUsuario.ADMIN_CENTRO_AYUDA),
            new UsuarioSemilla("Paula Méndez", "acopio@nexovital.co", "acopio123", RolUsuario.ADMIN_ACOPIO),
            new UsuarioSemilla("Ana Gómez", "ciudadano@nexovital.co", "ciudadano123", RolUsuario.CIUDADANO),
            new UsuarioSemilla("Carlos Pérez", "conductor1@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Laura Restrepo", "conductor2@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Andrés Gómez", "conductor3@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Valentina Ruiz", "conductor4@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Diego Herrera", "conductor5@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR));

    /**
     * Los 3 centros de Bogotá que el front usa hoy. Los nombres y las
     * coordenadas se reutilizan literales de los fixtures del front
     * ({@code Front_NexoVital/src/mocks/fixtures.ts}, {@code MOCK_CENTROS_AYUDA})
     * para que la versión con backend pinte los mismos centros. {@code zonaId}
     * es la localidad de Bogotá donde están los tres (Suba); la zona es
     * propiedad del módulo {@code mapa}, aquí es una referencia simple.
     *
     * <p>La Gaitana conserva su coordenada real ({@code 4.72, -74.05}): es un
     * sector de Suba y cae DENTRO del contorno sembrado de Suba, a ~700 m del
     * borde con Usaquén. El bug que se veía en el mapa no era el {@code zonaId}
     * sino que la zona se dibujaba como un punto: la etiqueta de Usaquén quedaba
     * cerca y parecía que el centro le pertenecía. Lo verifica
     * {@code MapaHttpTest.t5_cadaCentroCaeDentroDeSuZona}.
     */
    private static final List<OrganizacionSemilla> CATALOGO_ORGANIZACIONES = List.of(
            new OrganizacionSemilla("Acopio Suba Norte", TipoOrganizacion.CENTRO_ACOPIO, "Suba", 4.742d, -74.09d),
            new OrganizacionSemilla("Acopio La Gaitana", TipoOrganizacion.CENTRO_ACOPIO, "Suba", 4.72d, -74.05d),
            new OrganizacionSemilla("Acopio Tibabuyes", TipoOrganizacion.CENTRO_ACOPIO, "Suba", 4.73d, -74.1d));

    /**
     * Inventario de demostración de los 3 centros de acopio, LITERAL de los
     * fixtures del front ({@code Front_NexoVital/src/mocks/fixtures.ts},
     * {@code MOCK_CENTROS_AYUDA}): mismas cantidades que el mockup para que
     * c7/c8 pinten el mismo semáforo contra el back real. El techo del 80 % es
     * inclusivo en el dominio ({@code ItemInventario.semaforo()}), a diferencia
     * del front, que usa {@code > 0.8}; es el borde conocido y no se cambia acá.
     *
     * <p>Los ids de item son deterministas (derivados del centro y el nombre, ver
     * {@link #idDeItem}) para poder sembrar de forma idempotente sin una clave
     * natural en la tabla.
     */
    private static final List<InventarioSemilla> CATALOGO_INVENTARIO = List.of(
            new InventarioSemilla("Acopio Suba Norte", List.of(
                    new ItemInventarioSemilla("Agua potable", 12, 60, "bidones", "bidones de 5 L"),
                    new ItemInventarioSemilla("Kits de higiene", 18, 40, "kits", null),
                    new ItemInventarioSemilla("Medicamentos básicos", 32, 35, "cajas", null),
                    new ItemInventarioSemilla("Cobijas", 44, 50, "unidades", null))),
            new InventarioSemilla("Acopio La Gaitana", List.of(
                    new ItemInventarioSemilla("Alimentos", 90, 200, null, null),
                    new ItemInventarioSemilla("Agua potable", 300, 300, "bidones", null),
                    new ItemInventarioSemilla("Cobijas", 40, 0, "unidades", null))),
            new InventarioSemilla("Acopio Tibabuyes", List.of(
                    new ItemInventarioSemilla("Agua potable", 500, 500, "bidones", null),
                    new ItemInventarioSemilla("Alimentos", 360, 400, null, null),
                    new ItemInventarioSemilla("Cobijas", 200, 0, "unidades", null))));

    /**
     * Las zonas de Bogotá que el front ya usa como {@code zonaId} en sus
     * fixtures ({@code Front_NexoVital/src/mocks/fixtures.ts}: ambulancias y
     * emergencias). Los ids coinciden literalmente con esos {@code zonaId};
     * {@code Suba} es la zona que referencia la semilla de organizaciones, así
     * que el mapa siempre tiene la zona de sus centros.
     *
     * <p><b>Origen del contorno — HONESTO:</b> estos polígonos son
     * SIMPLIFICADOS y APROXIMADOS para la demo. NO son el límite oficial de la
     * localidad ni salen de una fuente geográfica: se dibujaron a mano a partir
     * de referencias conocidas (Autopista Norte, Río Juan Amarillo, Cerros
     * Orientales, etc.) con los vértices suficientes para que la forma sea
     * reconocible. Es dato de demostración, igual que los usuarios y centros
     * sembrados; para un contorno real haría falta el geodato oficial. Las
     * coordenadas ({@code lat}, {@code lng}) siguen siendo el punto de
     * referencia de la zona, reutilizado de los mismos fixtures.
     */
    private static final List<ZonaSemilla> CATALOGO_ZONAS = List.of(
            new ZonaSemilla("Suba", "Suba", 4.73d, -74.08d, List.of(
                    vertice(4.790d, -74.100d),
                    vertice(4.795d, -74.050d),
                    vertice(4.755d, -74.032d),
                    vertice(4.700d, -74.050d),
                    vertice(4.685d, -74.075d),
                    vertice(4.690d, -74.115d),
                    vertice(4.735d, -74.135d),
                    vertice(4.775d, -74.125d))),
            new ZonaSemilla("Usaquén", "Usaquén", 4.701d, -74.041d, List.of(
                    vertice(4.830d, -74.020d),
                    vertice(4.840d, -73.990d),
                    vertice(4.720d, -73.985d),
                    vertice(4.675d, -74.015d),
                    vertice(4.678d, -74.050d),
                    vertice(4.735d, -74.038d),
                    vertice(4.800d, -74.035d))),
            new ZonaSemilla("Engativá", "Engativá", 4.692d, -74.112d, List.of(
                    vertice(4.720d, -74.130d),
                    vertice(4.715d, -74.085d),
                    vertice(4.665d, -74.075d),
                    vertice(4.640d, -74.100d),
                    vertice(4.655d, -74.155d),
                    vertice(4.700d, -74.165d))),
            new ZonaSemilla("Kennedy", "Kennedy", 4.628d, -74.144d, List.of(
                    vertice(4.665d, -74.160d),
                    vertice(4.660d, -74.115d),
                    vertice(4.600d, -74.105d),
                    vertice(4.575d, -74.135d),
                    vertice(4.585d, -74.185d),
                    vertice(4.650d, -74.190d))),
            new ZonaSemilla("Bosa", "Bosa", 4.608d, -74.186d, List.of(
                    vertice(4.640d, -74.200d),
                    vertice(4.635d, -74.155d),
                    vertice(4.585d, -74.150d),
                    vertice(4.560d, -74.180d),
                    vertice(4.580d, -74.225d),
                    vertice(4.625d, -74.225d))),
            new ZonaSemilla("Centro", "Centro", 4.598d, -74.075d, List.of(
                    vertice(4.620d, -74.095d),
                    vertice(4.615d, -74.060d),
                    vertice(4.575d, -74.060d),
                    vertice(4.565d, -74.090d),
                    vertice(4.585d, -74.105d),
                    vertice(4.610d, -74.100d))));

    /**
     * Una ambulancia disponible por cada conductor demo (decisión D-F6). Las
     * placas se toman de los nombres del catálogo de usuarios (ABC101..ABC505) y
     * el {@code conductorId} se resuelve por email, de modo que la ambulancia
     * queda enlazada al usuario conductor. Todas se siembran en {@code Suba},
     * la zona que el seeder ya declara: así un {@code POST /solicitudes} de esa
     * zona notifica a las cinco y el broadcast C2 es observable de punta a
     * punta.
     *
     * <p>El enlace conductor↔ambulancia es la llave del push por usuario: el
     * listener post-commit resuelve {@code Ambulancia.conductorId} y publica en
     * el destino propio de ese conductor.
     */
    private static final List<AmbulanciaSemilla> CATALOGO_AMBULANCIAS = List.of(
            new AmbulanciaSemilla("ABC101", "conductor1@nexovital.co", "Suba", 4.735d, -74.080d),
            new AmbulanciaSemilla("ABC202", "conductor2@nexovital.co", "Suba", 4.745d, -74.095d),
            new AmbulanciaSemilla("ABC303", "conductor3@nexovital.co", "Suba", 4.720d, -74.060d),
            new AmbulanciaSemilla("ABC404", "conductor4@nexovital.co", "Suba", 4.760d, -74.075d),
            new AmbulanciaSemilla("ABC505", "conductor5@nexovital.co", "Suba", 4.700d, -74.090d));

    private final UsuarioRepository usuarioRepository;
    private final OrganizacionRepository organizacionRepository;
    private final ZonaRepository zonaRepository;
    private final PasswordEncoderPort passwordEncoderPort;
    private final ItemInventarioJpaRepository itemInventarioJpaRepository;
    private final AmbulanciaJpaRepository ambulanciaJpaRepository;

    public DataSeeder(UsuarioRepository usuarioRepository,
                      OrganizacionRepository organizacionRepository,
                      ZonaRepository zonaRepository,
                      PasswordEncoderPort passwordEncoderPort,
                      ItemInventarioJpaRepository itemInventarioJpaRepository,
                      AmbulanciaJpaRepository ambulanciaJpaRepository) {
        this.usuarioRepository = usuarioRepository;
        this.organizacionRepository = organizacionRepository;
        this.zonaRepository = zonaRepository;
        this.passwordEncoderPort = passwordEncoderPort;
        this.itemInventarioJpaRepository = itemInventarioJpaRepository;
        this.ambulanciaJpaRepository = ambulanciaJpaRepository;
    }

    @Override
    public void run(String... args) {
        sembrarUsuarios();
        sembrarOrganizaciones();
        sembrarZonas();
        sembrarInventario();
        sembrarAmbulancias();
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
                    new Ubicacion(semilla.lat(), semilla.lng()),
                    semilla.contorno()));
            sembradas++;
            LOG.info("Zona demo sembrada: {}", semilla.id());
        }
        LOG.info("Seed de zonas demo finalizado: {} nuevas de {} en el catálogo",
                sembradas, CATALOGO_ZONAS.size());
    }

    /**
     * Idempotente por id de item: el id se deriva del centro y el nombre, así
     * que reiniciar la aplicación no duplica filas ni falla. Los centros se
     * resuelven por nombre contra las organizaciones ya sembradas.
     */
    private void sembrarInventario() {
        Map<String, UUID> centroPorNombre = organizacionRepository.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .collect(Collectors.toMap(Organizacion::getNombre, Organizacion::getId));

        int sembrados = 0;
        for (InventarioSemilla semilla : CATALOGO_INVENTARIO) {
            UUID centroId = centroPorNombre.get(semilla.centroNombre());
            if (centroId == null) {
                LOG.warn("Centro demo no encontrado, seed de inventario omitido: {}", semilla.centroNombre());
                continue;
            }
            for (ItemInventarioSemilla item : semilla.items()) {
                UUID itemId = idDeItem(centroId, item.nombre());
                if (itemInventarioJpaRepository.existsById(itemId)) {
                    continue;
                }
                itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                        itemId,
                        centroId,
                        item.nombre(),
                        item.disponible(),
                        item.requerido(),
                        item.unidad(),
                        item.unitDetail()));
                sembrados++;
                LOG.info("Item de inventario demo sembrado: {} / {}", item.nombre(), semilla.centroNombre());
            }
        }
        LOG.info("Seed de inventario demo finalizado: {} nuevos de {} centros en el catálogo",
                sembrados, CATALOGO_INVENTARIO.size());
    }

    /**
     * Idempotente por placa: una ambulancia que ya existe no se vuelve a
     * insertar, así que reiniciar la aplicación no duplica filas ni falla. El
     * conductor se resuelve por email contra los usuarios ya sembrados; si no
     * existe, la siembra de esa ambulancia se omite con un log (nunca falla el
     * arranque).
     */
    private void sembrarAmbulancias() {
        int sembradas = 0;
        for (AmbulanciaSemilla semilla : CATALOGO_AMBULANCIAS) {
            if (ambulanciaJpaRepository.findByPlaca(semilla.placa()).isPresent()) {
                LOG.info("Ambulancia demo ya existe, seed omitido: {}", semilla.placa());
                continue;
            }
            UUID conductorId = usuarioRepository.buscarPorEmail(semilla.emailConductor())
                    .map(Usuario::getId)
                    .orElse(null);
            if (conductorId == null) {
                LOG.warn("Conductor demo no encontrado, seed de ambulancia omitido: {} ({})",
                        semilla.placa(), semilla.emailConductor());
                continue;
            }
            ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                    UUID.randomUUID(),
                    semilla.placa(),
                    EstadoAmbulancia.DISPONIBLE,
                    semilla.lat(),
                    semilla.lng(),
                    semilla.zona(),
                    conductorId));
            sembradas++;
            LOG.info("Ambulancia demo sembrada: {} (zona {})", semilla.placa(), semilla.zona());
        }
        LOG.info("Seed de ambulancias demo finalizado: {} nuevas de {} en el catálogo",
                sembradas, CATALOGO_AMBULANCIAS.size());
    }

    /** Id determinista del item, para que el seed sea idempotente sin clave natural. */
    private static UUID idDeItem(UUID centroId, String nombre) {
        return UUID.nameUUIDFromBytes((centroId + ":" + nombre).getBytes(StandardCharsets.UTF_8));
    }
}
