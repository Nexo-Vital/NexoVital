import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  type DireccionSugerida,
  formatCoordenadas,
  MIN_ADDRESS_QUERY,
  reverseGeocode,
  searchAddress,
} from '@/features/geocodificacion/geocoding-api';
import {
  type DeviceLocationState,
  INSECURE_CONTEXT_MESSAGE,
} from '@/features/geolocalizacion/use-device-location';
import type { Ubicacion } from '@/types/domain';

/** How the person is telling us where the point is. */
type LocationMode = 'gps' | 'address';

/** Type-ahead state of the address search. */
type SearchStatus = 'idle' | 'loading' | 'empty' | 'error';

/**
 * Pause after the last keystroke before searching. The geocoder is a shared
 * public service: one request per pause, not one per letter.
 */
export const LOCATION_SEARCH_DEBOUNCE_MS = 350;

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface LocationPickerProps {
  /** Prefix of the field ids, so two pickers on a page never share an id. */
  idPrefix: string;
  /**
   * The point the person has on screen. It only BIASES the address search
   * towards that side of the city; it is never the chosen point.
   */
  bias: Ubicacion;
  /**
   * Device GPS owned by the always-mounted page. The picker never opens its own
   * watcher: a second high-accuracy watch would run for the whole session.
   */
  location: DeviceLocationState;
  /** Reports the chosen point, or `null` when the choice was undone. */
  onChange: (point: Ubicacion | null) => void;
  /** Validation message of the owning form; shown under the picker. */
  error?: string | null;
  /** Example shown inside the address field. */
  placeholder?: string;
}

/**
 * Location field with two sources, neither of which asks for coordinates: "Mi
 * ubicación actual" (the device GPS, shown back as its approximate address) and
 * "Escribir dirección" (a search with suggestions).
 *
 * It follows the same rules as the "Reportar zona afectada" dialog, the pattern
 * the team approved: the coordinates are what the form sends and the address is
 * only how a person reads them, so a geocoder failure never blocks the form (the
 * GPS path falls back to showing the coordinates). GPS is a shortcut, never a
 * gate: without a fix the picker moves to the address path.
 */
export function LocationPicker({
  idPrefix,
  bias,
  location,
  onChange,
  error = null,
  placeholder = 'Ej.: Carrera 7 con calle 45, Bogotá',
}: LocationPickerProps) {
  const [mode, setMode] = useState<LocationMode | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  /** Readable text of the chosen point; `null` while none is chosen. */
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DireccionSugerida[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  /** The text a picked suggestion wrote into the input; it must not re-search. */
  const pickedQuery = useRef<string | null>(null);
  /** Invalidates a reverse lookup the person has already moved on from. */
  const reverseToken = useRef(0);

  // Debounced address search. A newer keystroke aborts the request in flight, so
  // a slow answer to "Calle 1" can never overwrite the list for "Calle 100".
  const biasLat = bias.lat;
  const biasLng = bias.lng;
  useEffect(() => {
    if (mode !== 'address') {
      return;
    }
    const text = query.trim();
    if (text.length < MIN_ADDRESS_QUERY || text === pickedQuery.current) {
      setSuggestions([]);
      setSearchStatus('idle');
      return;
    }
    const controller = new AbortController();
    setSearchStatus('loading');
    const timeoutId = setTimeout(() => {
      searchAddress(text, { cerca: { lat: biasLat, lng: biasLng }, signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted) {
            return;
          }
          setSuggestions(found);
          setSearchStatus(found.length > 0 ? 'idle' : 'empty');
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }
          setSuggestions([]);
          setSearchStatus('error');
        });
    }, LOCATION_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [mode, query, biasLat, biasLng]);

  const useDevicePosition = () => {
    const position = location.position;
    reverseToken.current += 1;
    if (!position) {
      // No fix: the address path is the way forward, so open it right away.
      setMode('address');
      onChange(null);
      setChosenLabel(null);
      setGeoMessage(
        location.status === 'unsupported'
          ? INSECURE_CONTEXT_MESSAGE
          : 'No pudimos obtener tu ubicación del dispositivo. Escribe la dirección.',
      );
      return;
    }
    const token = reverseToken.current;
    setMode('gps');
    setGeoMessage(null);
    onChange(position);
    setChosenLabel('Buscando la dirección…');
    reverseGeocode(position)
      .then((address) => {
        if (reverseToken.current !== token) {
          return;
        }
        setChosenLabel(address ? `Cerca de ${address}` : formatCoordenadas(position));
      })
      .catch(() => {
        if (reverseToken.current === token) {
          setChosenLabel(formatCoordenadas(position));
        }
      });
  };

  const useAddress = () => {
    if (mode === 'address') {
      return;
    }
    reverseToken.current += 1;
    setMode('address');
    setGeoMessage(null);
    onChange(null);
    setChosenLabel(null);
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);
    // Editing the text invalidates the point picked for the previous text.
    if (pickedQuery.current !== null && text !== pickedQuery.current) {
      pickedQuery.current = null;
      onChange(null);
      setChosenLabel(null);
    }
  };

  const pickSuggestion = (suggestion: DireccionSugerida) => {
    pickedQuery.current = suggestion.etiqueta;
    setQuery(suggestion.etiqueta);
    setSuggestions([]);
    setSearchStatus('idle');
    onChange(suggestion.ubicacion);
    setChosenLabel(suggestion.etiqueta);
  };

  const addressId = `${idPrefix}-address`;

  return (
    <div className="flex flex-col gap-2">
      <span className="nv-label text-muted-foreground">Ubicación</span>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'gps' ? 'default' : 'outline'}
          aria-pressed={mode === 'gps'}
          onClick={useDevicePosition}
        >
          Mi ubicación actual
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'address' ? 'default' : 'outline'}
          aria-pressed={mode === 'address'}
          onClick={useAddress}
        >
          Escribir dirección
        </Button>
      </div>
      {geoMessage && (
        <p role="status" className="text-muted-foreground text-[11px]">
          {geoMessage}
        </p>
      )}

      {mode === 'address' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={addressId} className="nv-label text-muted-foreground">
            Dirección
          </label>
          <input
            id={addressId}
            name="direccion"
            type="search"
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            aria-invalid={Boolean(error)}
            className={FIELD_CLASS}
          />
          {searchStatus === 'loading' && (
            <p role="status" className="text-muted-foreground text-[11px]">
              Buscando direcciones…
            </p>
          )}
          {searchStatus === 'empty' && (
            <p role="status" className="text-muted-foreground text-[11px]">
              No encontramos esa dirección. Prueba con la calle o el barrio.
            </p>
          )}
          {searchStatus === 'error' && (
            <p role="status" className="text-muted-foreground text-[11px]">
              El buscador de direcciones no responde. Inténtalo de nuevo o usa tu ubicación actual.
            </p>
          )}
          {suggestions.length > 0 && (
            <ul
              aria-label="Direcciones sugeridas"
              className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-input"
            >
              {suggestions.map((suggestion) => (
                <li key={suggestion.etiqueta}>
                  <button
                    type="button"
                    onClick={() => pickSuggestion(suggestion)}
                    className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    {suggestion.etiqueta}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {chosenLabel && (
        <p className="rounded-md bg-muted px-2 py-1.5 text-sm">
          <span className="nv-label text-muted-foreground">Ubicación elegida: </span>
          <span data-testid={`${idPrefix}-chosen-location`}>{chosenLabel}</span>
        </p>
      )}
      {mode === 'gps' && chosenLabel && (
        <p className="text-muted-foreground text-[11px]">
          La dirección es aproximada; el punto exacto es el de tu dispositivo.
        </p>
      )}
      {error && (
        <p role="alert" className="text-critical text-[11px]">
          {error}
        </p>
      )}
    </div>
  );
}
