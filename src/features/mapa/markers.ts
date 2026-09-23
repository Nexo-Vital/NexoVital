import L from 'leaflet';
import {
  CENTER_LEVEL_STYLE,
  centerShortName,
  citizenCenterLevel,
  NOT_DECLARED_CENTER_STYLE,
} from '@/features/ciudadano/citizen-view';
import { centroSemaforo } from '@/features/recursos/traffic-light';
import type { Ambulancia, CentroAyuda, Emergencia, TrafficLight } from '@/types/domain';

/**
 * Leaflet's default marker images break under Vite, so every marker is a
 * `L.divIcon` whose colours come from CSS classes (never inline hex values).
 *
 * Shapes follow the v2 mockup: aid centres are rounded squares carrying a
 * traffic-light badge, ambulances are circles carrying an availability badge,
 * and the viewer is a static blue dot. The centre colours are shared with the
 * citizen legend through `citizen-view`'s `CENTER_LEVEL_STYLE`, so a pin can
 * never contradict the swatch beside it.
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
 * Inline Lucide path bodies. Leaflet's `divIcon` takes an HTML string rather
 * than a React node, so the icons are inlined here instead of imported from
 * `lucide-react`.
 */
const ICON_PATHS = {
  warehouse:
    '<path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 1.316-1.88l8-3.2a2 2 0 0 1 1.368 0l8 3.2A2 2 0 0 1 22 8.5z"/><path d="M6 13h12"/><path d="M6 17h12"/>',
  ambulance:
    '<path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.68-.95l-1.93-.64a1 1 0 0 1-.58-.5l-1.54-3.08A1 1 0 0 0 16.38 8H14"/><path d="M8 8v4"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alertTriangle:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  octagonAlert:
    '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.31 2a2 2 0 0 1 1.41.59l4.69 4.69A2 2 0 0 1 22 8.69v6.62a2 2 0 0 1-.59 1.41l-4.69 4.69a2 2 0 0 1-1.41.59H8.69a2 2 0 0 1-1.41-.59l-4.69-4.69A2 2 0 0 1 2 15.31V8.69a2 2 0 0 1 .59-1.41l4.69-4.69A2 2 0 0 1 8.69 2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
} as const;

/** Wraps Lucide path bodies in the themed stroke SVG the CSS sizes per shape. */
function strokeGlyph(paths: string): string {
  return `<svg class="nv-marker__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const WAREHOUSE_GLYPH = strokeGlyph(ICON_PATHS.warehouse);
const AMBULANCE_GLYPH = strokeGlyph(ICON_PATHS.ambulance);
const CHECK_GLYPH = strokeGlyph(ICON_PATHS.check);
const CLOCK_GLYPH = strokeGlyph(ICON_PATHS.clock);
const USER_GLYPH = strokeGlyph(ICON_PATHS.user);

/** Centre badge glyph per traffic light: shape and colour, never colour alone. */
const CENTER_BADGE_GLYPH: Record<TrafficLight, string> = {
  GREEN: strokeGlyph(ICON_PATHS.circleCheck),
  AMBER: strokeGlyph(ICON_PATHS.alertTriangle),
  RED: strokeGlyph(ICON_PATHS.octagonAlert),
  NOT_DECLARED: strokeGlyph(ICON_PATHS.info),
};

/**
 * Emergency marker: a location pin carrying an alert sign.
 *
 * An emergency is an EVENT with a place, not a physical object, so the glyph
 * reads as "attention here" instead of looking like equipment. It is outside
 * the v2 marker redesign and keeps its semantic level colours.
 */
const EVENT_GLYPH =
  '<svg class="nv-marker__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor"></path>' +
  '<rect x="11" y="5.5" width="2" height="6" rx="1" fill="var(--nv-bg)"></rect>' +
  '<circle cx="12" cy="14.3" r="1.15" fill="var(--nv-bg)"></circle>' +
  '</svg>';

function buildMarkerIcon(html: string, size: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Ambulance marker: 40px circle with an availability badge.
 *
 * The mockup does not rotate vehicles, so there is no heading transform. The
 * shape and colours come from the `nv-marker--{state}` CSS classes; only the
 * badge icon (check vs clock) is decided here, because AVAILABLE is the free
 * variant and every other state is busy. MAINTENANCE reuses the busy variant
 * (the mockup does not draw it separately).
 *
 * `notified` adds the static teal ring a unit gets while it is part of an open
 * request's `notificadas`. It defaults to false, so the citizen and CRUE maps
 * draw exactly the same marker they always did. `label` overrides the default
 * unit-id label (the citizen tracking screen writes "A-07 · 5 min").
 */
export function ambulanceIcon(
  ambulance: Ambulancia,
  selected: boolean,
  notified = false,
  dim = false,
  label?: string,
): L.DivIcon {
  const stateClass = `nv-marker--${ambulance.estado.toLowerCase()}`;
  const selectedClass = selected ? ' nv-marker--selected' : '';
  const simulatedClass = ambulance.source === 'simulated' ? ' nv-marker--sim' : '';
  const notifiedClass = notified ? ' nv-marker--notified' : '';
  const dimClass = dim ? ' nv-marker--dim' : '';
  const badge = ambulance.estado === 'AVAILABLE' ? CHECK_GLYPH : CLOCK_GLYPH;
  const html =
    `<div class="nv-marker nv-marker--unit ${stateClass}${selectedClass}${simulatedClass}${notifiedClass}${dimClass}">` +
    `<span class="nv-marker__shape">${AMBULANCE_GLYPH}</span>` +
    `<span class="nv-marker__badge">${badge}</span>` +
    `<span class="nv-marker__label">${escapeHtml(label ?? ambulance.id)}</span>` +
    `</div>`;
  return buildMarkerIcon(html, 40);
}

/**
 * Radar rings anchored on the citizen while a request is open (mockup `C.c3`):
 * a static filled outer ring plus two animated rings. `sizePx` is the icon's
 * pixel diameter, and the caller sizes it so the OUTER ring spans the search's
 * real ground diameter at the current zoom (`radarRingsPixelDiameter`); the two
 * inner rings keep the mockup's 67%/40% proportions in CSS. The rings therefore
 * cover the same terrain at any zoom. Rendered as its own marker so it paints
 * below the "Tú" dot; the animation itself lives in CSS and only runs when the
 * user allows motion.
 */
export function citizenRingsIcon(sizePx: number): L.DivIcon {
  const html =
    `<div class="nv-rings">` +
    `<span class="nv-ring nv-ring--fill"></span>` +
    `<span class="nv-ring nv-ring--anim"></span>` +
    `<span class="nv-ring nv-ring--anim nv-ring--d2"></span>` +
    `</div>`;
  return buildMarkerIcon(html, sizePx);
}

/**
 * Requester marker (`pinReq` in the mockup): a 44px red circle with a person
 * glyph, wrapped in two STATIC red rings (92px at opacity .45 and 64px at .75).
 *
 * The rings are decoration, not a geographic radius: they are fixed-pixel
 * circles drawn around the pin, and they never animate.
 */
export function requestIcon(label: string): L.DivIcon {
  const html =
    `<div class="nv-marker nv-marker--request">` +
    `<span class="nv-marker__request-ring nv-marker__request-ring--outer"></span>` +
    `<span class="nv-marker__request-ring nv-marker__request-ring--inner"></span>` +
    `<span class="nv-marker__shape">${USER_GLYPH}</span>` +
    `<span class="nv-marker__label">${escapeHtml(label)}</span>` +
    `</div>`;
  return buildMarkerIcon(html, 92);
}

/**
 * "You are here" marker: a 24px blue dot with a STATIC ring.
 *
 * The label defaults to the driver console's SIM/YOU so its screen is unchanged;
 * the citizen map passes its own label ("Tú") through the same marker. The ring
 * lives in the shape's box-shadow, so there is no animation and no extra node.
 */
export function selfIcon(simulated: boolean, label?: string): L.DivIcon {
  const simulatedClass = simulated ? ' nv-marker--sim' : '';
  const text = label ?? (simulated ? 'SIM' : 'YOU');
  const html =
    `<div class="nv-marker nv-marker--self${simulatedClass}">` +
    `<span class="nv-marker__shape"></span>` +
    `<span class="nv-marker__label">${escapeHtml(text)}</span>` +
    `</div>`;
  return buildMarkerIcon(html, 24);
}

/** Emergency marker: level colour from the modifier, alert-pin glyph. */
export function emergencyIcon(emergency: Emergencia): L.DivIcon {
  const html =
    `<div class="nv-marker nv-marker--${emergency.nivel.toLowerCase()}">` +
    `<span class="nv-marker__shape">${EVENT_GLYPH}</span>` +
    `<span class="nv-marker__label">${escapeHtml(emergency.id)}</span>` +
    `</div>`;
  return buildMarkerIcon(html, 30);
}

/**
 * Aid-centre marker: 48px rounded square coloured by the centre's worst
 * inventory level, with a badge that repeats the level as an icon.
 *
 * The colours come from `CENTER_LEVEL_STYLE` — the same table the citizen legend
 * reads — written into the `--nv-marker-*` custom properties the CSS consumes.
 */
export function centerIcon(center: CentroAyuda, selected = false): L.DivIcon {
  const traffic = centroSemaforo(center);
  const level = citizenCenterLevel(traffic);
  const style = level ? CENTER_LEVEL_STYLE[level] : NOT_DECLARED_CENTER_STYLE;
  const selectedClass = selected ? ' nv-marker--selected' : '';
  const styleAttribute = `--nv-marker-bg: ${style.bg}; --nv-marker-color: ${style.fg}; --nv-marker-badge-color: ${style.badgeFg}`;
  const html =
    `<div class="nv-marker nv-marker--center${selectedClass}" style="${styleAttribute}">` +
    `<span class="nv-marker__shape">${WAREHOUSE_GLYPH}</span>` +
    `<span class="nv-marker__badge">${CENTER_BADGE_GLYPH[traffic]}</span>` +
    `<span class="nv-marker__label">${escapeHtml(centerShortName(center))}</span>` +
    `</div>`;
  return buildMarkerIcon(html, 48);
}
