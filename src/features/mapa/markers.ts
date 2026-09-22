import L from 'leaflet';
import { centroSemaforo } from '@/features/recursos/traffic-light';
import type { Ambulancia, CentroAyuda, Emergencia, TrafficLight } from '@/types/domain';

/**
 * Leaflet's default marker images break under Vite, so every marker is a
 * `L.divIcon` whose colors come from CSS classes (never inline hex values).
 * Three shapes exist: a top-down vehicle for units, an alert pin for events and
 * a building for aid centres.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Top-down vehicle, drawn inline because Leaflet's `divIcon` takes an HTML
 * string rather than a React node.
 *
 * Deliberately TOP-DOWN and not a service icon: the marker rotates to the
 * unit's compass heading, and a side-view vehicle rotated by a bearing reads as
 * broken. The nose is marked by the knocked-out windscreen and the roof carries
 * an ambulance cross, both painted in the page background so they follow the
 * theme. The body takes `currentColor`, which the per-state CSS owns.
 */
const VEHICLE_GLYPH =
  '<svg class="nv-marker__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<rect x="6.5" y="2.5" width="11" height="19" rx="3" fill="currentColor"></rect>' +
  '<rect x="8.75" y="6" width="6.5" height="2" rx="1" fill="var(--nv-bg)"></rect>' +
  '<path d="M10.5 12.1h3v1.8h1.8v1.8h-1.8v1.8h-3v-1.8H8.7v-1.8h1.8z" fill="var(--nv-bg)"></path>' +
  '</svg>';

/**
 * Emergency marker: a location pin carrying an alert sign.
 *
 * An emergency is an EVENT with a place, not a physical object, so the glyph
 * reads as "attention here" instead of looking like equipment. The round head
 * and the pointed tail stay legible at 26px, and the exclamation is knocked out
 * in the page background while the body takes `currentColor` for the level CSS.
 */
const EVENT_GLYPH =
  '<svg class="nv-marker__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor"></path>' +
  '<rect x="11" y="5.5" width="2" height="6" rx="1" fill="var(--nv-bg)"></rect>' +
  '<circle cx="12" cy="14.3" r="1.15" fill="var(--nv-bg)"></circle>' +
  '</svg>';

/**
 * Aid-center marker: a building silhouette.
 *
 * A centre is a PLACE, so it gets a wide, roofed shape with punched windows and
 * a door — unmistakably different from the narrow vehicle and the pointed
 * emergency pin, even at small size.
 */
const FACILITY_GLYPH =
  '<svg class="nv-marker__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M4.5 21V8.4L12 3l7.5 5.4V21z" fill="currentColor"></path>' +
  '<rect x="7.4" y="10.4" width="3" height="3" rx="0.5" fill="var(--nv-bg)"></rect>' +
  '<rect x="13.6" y="10.4" width="3" height="3" rx="0.5" fill="var(--nv-bg)"></rect>' +
  '<rect x="10.4" y="15.4" width="3.2" height="5.6" rx="0.6" fill="var(--nv-bg)"></rect>' +
  '</svg>';

/**
 * Aid-center colour by worst inventory level. Values reference the shared
 * design tokens (never inline hex) so the palette keeps a single source.
 */
const SEMAFORO_COLOR: Record<TrafficLight, string> = {
  RED: 'var(--nv-critical)',
  AMBER: 'var(--nv-warning)',
  GREEN: 'var(--nv-ok)',
  NOT_DECLARED: 'var(--nv-idle)',
};

/** Rotates the vehicle to its heading. North (0°) points up, matching the glyph. */
function headingAttribute(heading: number | null | undefined): string {
  if (heading === null || heading === undefined || !Number.isFinite(heading)) {
    return '';
  }
  return ` style="transform: rotate(${Math.round(heading)}deg)"`;
}

function buildGlyphIcon(
  modifierClasses: string,
  label: string,
  glyph: string,
  extraAttributes = '',
): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="nv-marker ${modifierClasses}"${extraAttributes}><span class="nv-marker__shape">${glyph}</span><span class="nv-marker__label">${escapeHtml(label)}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function buildVehicleIcon(
  modifierClasses: string,
  label: string,
  heading: number | null | undefined,
): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="nv-marker ${modifierClasses}"><span class="nv-marker__shape nv-marker__vehicle"${headingAttribute(heading)}>${VEHICLE_GLYPH}</span><span class="nv-marker__label">${escapeHtml(label)}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export function ambulanceIcon(ambulance: Ambulancia, selected: boolean): L.DivIcon {
  const stateClass = `nv-marker--${ambulance.estado.toLowerCase()}`;
  const selectedClass = selected ? ' nv-marker--selected' : '';
  const simulatedClass = ambulance.source === 'simulated' ? ' nv-marker--sim' : '';
  return buildVehicleIcon(
    `${stateClass}${selectedClass}${simulatedClass}`,
    ambulance.id,
    ambulance.heading,
  );
}

/**
 * "You are here" marker: pulsing ring + the vehicle glyph.
 *
 * The label defaults to the driver console's SIM/YOU so its screen is unchanged;
 * the citizen map passes its own label ("Tú") through the same marker.
 */
export function selfIcon(heading: number | null, simulated: boolean, label?: string): L.DivIcon {
  const simulatedClass = simulated ? ' nv-marker--sim' : '';
  const text = label ?? (simulated ? 'SIM' : 'YOU');
  return L.divIcon({
    className: '',
    html: `<div class="nv-marker nv-marker--self${simulatedClass}"><span class="nv-marker__ring"></span><span class="nv-marker__shape nv-marker__vehicle"${headingAttribute(heading)}>${VEHICLE_GLYPH}</span><span class="nv-marker__label">${escapeHtml(text)}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** Emergency marker: level colour from the existing modifier, alert-pin glyph. */
export function emergencyIcon(emergency: Emergencia): L.DivIcon {
  return buildGlyphIcon(`nv-marker--${emergency.nivel.toLowerCase()}`, emergency.id, EVENT_GLYPH);
}

/**
 * Aid-center marker: building glyph coloured by the centre's worst inventory
 * level, which is written into the shared `--nv-marker-color` custom property.
 */
export function centerIcon(center: CentroAyuda, selected = false): L.DivIcon {
  const selectedClass = selected ? ' nv-marker--selected' : '';
  const color = SEMAFORO_COLOR[centroSemaforo(center)];
  return buildGlyphIcon(
    `nv-marker--center${selectedClass}`,
    center.id,
    FACILITY_GLYPH,
    ` style="--nv-marker-color: ${color}"`,
  );
}
