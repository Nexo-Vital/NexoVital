package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroPropioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioDuplicadoException;
import co.edu.escuelaing.nexovital.recursos.domain.model.CentroPropio;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.model.MiCentro;
import co.edu.escuelaing.nexovital.recursos.domain.model.NuevoItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.AdministrarMiCentroUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.CentroPropioPort;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Centro del administrador de centro de ayuda: consulta, creación con insumos
 * iniciales y alta de insumos nuevos.
 *
 * <p>La creación es UNA transacción: el centro lo registra {@code usuarios}
 * (por {@link CentroPropioPort}) y los insumos se insertan aquí; como el caso de
 * uso de {@code usuarios} se une a esta transacción, un insumo inválido deshace
 * también el centro. Los avisos de tiempo real salen DESPUÉS del commit: el
 * centro por {@code /topic/map.events} (lo emite {@code usuarios}) y cada insumo
 * por {@code /topic/suministros}.
 *
 * <p>Los insumos se validan ANTES de registrar el centro, para rechazar la
 * petición sin tocar la base.
 */
@Service
public class AdministrarMiCentroUseCaseImpl implements AdministrarMiCentroUseCase {

    /** Tope de insumos en la creación: una petición no declara un catálogo sin fin. */
    static final int MAXIMO_ITEMS_INICIALES = 30;

    private final CentroPropioPort centroPropioPort;
    private final InventarioRepository inventarioRepository;
    private final ApplicationEventPublisher eventPublisher;

    public AdministrarMiCentroUseCaseImpl(CentroPropioPort centroPropioPort,
                                          InventarioRepository inventarioRepository,
                                          ApplicationEventPublisher eventPublisher) {
        this.centroPropioPort = centroPropioPort;
        this.inventarioRepository = inventarioRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<MiCentro> consultar(UUID adminId) {
        return centroPropioPort.buscarPorAdmin(adminId)
                .map(centro -> new MiCentro(centro, inventarioRepository.listarPorCentro(centro.id())));
    }

    @Override
    @Transactional
    public MiCentro crear(UUID adminId, String nombre, Double lat, Double lng, List<NuevoItemInventario> items) {
        // Un centro puede crearse sin inventario: no tiene nada y no necesita
        // nada, y se muestra como "completo" (EP-03.F2.US1). Los insumos se
        // agregan cuando haga falta.
        if (items == null) {
            items = List.of();
        }
        if (items.size() > MAXIMO_ITEMS_INICIALES) {
            throw new IllegalArgumentException(
                    "Un centro se crea con máximo " + MAXIMO_ITEMS_INICIALES + " insumos; agrega los demás después.");
        }
        List<String> nombres = new ArrayList<>(items.size());
        Set<String> vistos = new HashSet<>();
        for (NuevoItemInventario item : items) {
            if (item == null) {
                throw new IllegalArgumentException("Hay un insumo vacío en la lista.");
            }
            String limpio = item.validar();
            if (!vistos.add(limpio.toLowerCase(Locale.ROOT))) {
                throw new IllegalArgumentException("El insumo \"" + limpio + "\" está repetido.");
            }
            nombres.add(limpio);
        }

        CentroPropio centro = centroPropioPort.registrar(adminId, nombre, lat, lng);

        List<ItemInventario> guardados = new ArrayList<>(items.size());
        for (int i = 0; i < items.size(); i++) {
            guardados.add(insertar(centro.id(), nombres.get(i), items.get(i)));
        }
        return new MiCentro(centro, guardados);
    }

    @Override
    @Transactional
    public ItemInventario agregarItem(UUID adminId, NuevoItemInventario item) {
        if (item == null) {
            throw new IllegalArgumentException("El insumo es obligatorio.");
        }
        String limpio = item.validar();
        CentroPropio centro = centroPropioPort.buscarPorAdmin(adminId)
                .orElseThrow(CentroPropioNoEncontradoException::new);
        if (inventarioRepository.existePorNombre(centro.id(), limpio)) {
            throw new ItemInventarioDuplicadoException(limpio);
        }
        return insertar(centro.id(), limpio, item);
    }

    private ItemInventario insertar(UUID centroId, String nombre, NuevoItemInventario item) {
        ItemInventario guardado = inventarioRepository.guardar(new ItemInventario(
                UUID.randomUUID(), centroId, nombre, item.disponible(), item.requerido(), null, null));
        eventPublisher.publishEvent(new ItemInventarioRegistradoEvento(ItemInventarioDto.fromDomain(guardado)));
        return guardado;
    }
}
