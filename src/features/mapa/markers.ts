import L from 'leaflet';
import type { Ambulancia, CentroAyuda, Emergencia } from '@/types/domain';

/**
 * Leaflet's default marker images break under Vite, so every marker is a
 * `L.divIcon` whose colors come from CSS classes (never inline hex values).
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

function buildDivIcon(modifierClasses: string, label: string, extraHtml = ''): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="nv-marker ${modifierClasses}"><span class="nv-marker__dot"></span>${extraHtml}<span class="nv-marker__label">${escapeHtml(label)}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function headingHtml(heading: number | null | undefined): string {
  if (heading === null || heading === undefined || !Number.isFinite(heading)) {
    return '';
  }
  const angle = Math.round(heading);
  return `<span class="nv-marker__heading" style="transform: rotate(${angle}deg)"><span class="nv-marker__heading-arrow"></span></span>`;
}

export function ambulanceIcon(ambulance: Ambulancia, selected: boolean): L.DivIcon {
  const stateClass = `nv-marker--${ambulance.estado.toLowerCase()}`;
  const selectedClass = selected ? ' nv-marker--selected' : '';
  const simulatedClass = ambulance.source === 'simulated' ? ' nv-marker--sim' : '';
  return buildDivIcon(
    `${stateClass}${selectedClass}${simulatedClass}`,
    ambulance.id,
    headingHtml(ambulance.heading),
  );
}

/** The driver's own "You are here" marker: pulsing ring + optional heading arrow. */
export function selfIcon(heading: number | null, simulated: boolean): L.DivIcon {
  const simulatedClass = simulated ? ' nv-marker--sim' : '';
  return L.divIcon({
    className: '',
    html: `<div class="nv-marker nv-marker--self${simulatedClass}"><span class="nv-marker__ring"></span><span class="nv-marker__dot"></span>${headingHtml(heading)}<span class="nv-marker__label">${simulated ? 'SIM' : 'YOU'}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export function emergencyIcon(emergency: Emergencia): L.DivIcon {
  return buildDivIcon(`nv-marker--${emergency.nivel.toLowerCase()}`, emergency.id);
}

export function centerIcon(center: CentroAyuda): L.DivIcon {
  return buildDivIcon('nv-marker--center', center.id);
}
