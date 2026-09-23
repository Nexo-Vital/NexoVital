import { trafficLight } from '@/features/recursos/traffic-light';
import type {
  Ambulancia,
  CentroAyuda,
  Emergencia,
  GrammaticalNumber,
  InventarioItem,
  SolicitudAmbulancia,
} from '@/types/domain';

/**
 * Front-only fixtures for the CRUE operations room (Bogotá, approx 4.65/-74.06).
 * Internally consistent: request winners/assignees reference real ambulance ids
 * and the same zones appear across fleet, emergencies and requests.
 */

const NOW = Date.now();
const MINUTE = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * MINUTE).toISOString();
}

function minutesAhead(minutes: number): string {
  return new Date(NOW + minutes * MINUTE).toISOString();
}

function inventoryItem(
  id: string,
  centroAcopioId: string,
  nombre: string,
  disponible: number,
  requerido: number,
  grammaticalNumber: GrammaticalNumber,
): InventarioItem {
  return {
    id,
    centroAcopioId,
    nombre,
    disponible,
    requerido,
    semaforo: trafficLight(disponible, requerido),
    grammaticalNumber,
  };
}

/**
 * Demo fleet, aligned with the v2 mockup (`AMBS()`, lines 544-554).
 *
 * LITERAL from the mockup: the five ids and their availability (A-07/A-12/A-03
 * available, A-09/A-15 busy), and A-07's plate, model and type (`myUnit()`, line
 * 907: WNR-418, Renault Master 2023, Básica (TAB)).
 *
 * INVENTED demo data: the mockup only details A-07, so the plate, model and type
 * of A-12, A-03, A-09 and A-15 are made up here, chosen to be distinct from each
 * other and coherent with each unit's role. Positions are plausible points
 * around Bogotá; the app computes distances and ETAs from them, so they are not
 * the mockup's exact figures.
 */
export const MOCK_AMBULANCIAS: Ambulancia[] = [
  {
    id: 'A-07',
    placa: 'WNR-418',
    modelo: 'Renault Master 2023',
    tipo: 'Básica (TAB)',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.72, lng: -74.078 },
    zona: 'Suba',
    driverName: 'Carlos Pérez Gómez',
  },
  {
    id: 'A-12',
    placa: 'SNK-742',
    modelo: 'Chevrolet N300 2022',
    tipo: 'Básica (TAB)',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.701, lng: -74.041 },
    zona: 'Usaquén',
    driverName: 'Laura Restrepo Díaz',
  },
  {
    id: 'A-03',
    placa: 'HGV-259',
    modelo: 'Toyota Hiace 2021',
    tipo: 'Traslado asistencial',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.692, lng: -74.112 },
    zona: 'Engativá',
    driverName: 'Andrés Gómez Peña',
  },
  {
    id: 'A-09',
    placa: 'LQZ-813',
    modelo: 'Mercedes-Benz Sprinter 2023',
    tipo: 'UCI móvil',
    estado: 'ASSIGNED',
    ubicacion: { lat: 4.628, lng: -74.144 },
    zona: 'Kennedy',
    driverName: 'Valentina Ruiz Mora',
  },
  {
    id: 'A-15',
    placa: 'JTP-604',
    modelo: 'Ford Transit 2022',
    tipo: 'Básica (TAB)',
    estado: 'EN_ROUTE',
    ubicacion: { lat: 4.608, lng: -74.186 },
    zona: 'Bosa',
    driverName: 'Diego Herrera Cruz',
  },
];

export const MOCK_EMERGENCIAS: Emergencia[] = [
  {
    id: 'EMG-001',
    ubicacion: { lat: 4.598, lng: -74.075 },
    nivel: 'CRITICAL',
    estado: 'IN_PROGRESS',
    descripcion: 'Suspected cardiac arrest, adult male, bystander CPR in progress.',
    zonaId: 'Centro',
    createdAt: minutesAgo(9),
  },
  {
    id: 'EMG-002',
    ubicacion: { lat: 4.628, lng: -74.148 },
    nivel: 'HIGH',
    estado: 'REPORTED',
    descripcion: 'Two-vehicle collision, one trapped occupant, fire brigade on scene.',
    zonaId: 'Kennedy',
    createdAt: minutesAgo(4),
  },
  {
    id: 'EMG-003',
    ubicacion: { lat: 4.742, lng: -74.09 },
    nivel: 'MEDIUM',
    estado: 'IN_PROGRESS',
    descripcion: 'Respiratory distress in a pediatric patient, oxygen applied.',
    zonaId: 'Suba',
    createdAt: minutesAgo(12),
  },
  {
    id: 'EMG-004',
    ubicacion: { lat: 4.605, lng: -74.19 },
    nivel: 'CRITICAL',
    estado: 'ON_HOLD',
    descripcion: 'Partial structural collapse, two people unaccounted for.',
    zonaId: 'Bosa',
    createdAt: minutesAgo(21),
  },
  {
    id: 'EMG-005',
    ubicacion: { lat: 4.702, lng: -74.032 },
    nivel: 'LOW',
    estado: 'RESOLVED',
    descripcion: 'Minor fall at a residence, patient stable, transport declined.',
    zonaId: 'Usaquén',
    createdAt: minutesAgo(48),
  },
];

/**
 * Requests reference real units and centers from the lists above. Only the two
 * busy units carry an open assignment (A-15 EN_ROUTE and A-09 ASSIGNED): keeping
 * one unit on one mission is the C2 invariant, so no unit is assigned twice.
 *
 * A PENDING request only ever notifies AVAILABLE units, which is the rule the
 * request form enforces, so the two open requests list just the free units; the
 * resolved ones keep their historical notification list.
 */
export const MOCK_SOLICITUDES: SolicitudAmbulancia[] = [
  {
    id: 'REQ-1001',
    emergenciaId: 'EMG-002',
    estado: 'PENDING',
    centroAyudaId: 'CA-LA-GAITANA',
    zonaId: 'Kennedy',
    tipo: 'Traffic collision',
    solicitadaEn: minutesAgo(2),
    timeoutEn: minutesAhead(3),
    ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
    notifiedCount: 3,
    ambulanciaAsignadaId: null,
  },
  {
    id: 'REQ-1002',
    emergenciaId: 'EMG-001',
    estado: 'TAKEN',
    centroAyudaId: 'CA-SUBA-NORTE',
    zonaId: 'Centro',
    tipo: 'Cardiac arrest',
    solicitadaEn: minutesAgo(8),
    timeoutEn: minutesAgo(5),
    ambulanciasNotificadas: ['A-15', 'A-07', 'A-12'],
    notifiedCount: 3,
    ambulanciaAsignadaId: 'A-15',
  },
  {
    id: 'REQ-1003',
    emergenciaId: 'EMG-003',
    estado: 'ASSIGNED',
    centroAyudaId: 'CA-SUBA-NORTE',
    zonaId: 'Suba',
    tipo: 'Respiratory distress',
    solicitadaEn: minutesAgo(11),
    timeoutEn: minutesAgo(8),
    ambulanciasNotificadas: ['A-09', 'A-07', 'A-03', 'A-12'],
    notifiedCount: 4,
    ambulanciaAsignadaId: 'A-09',
  },
  {
    id: 'REQ-1004',
    emergenciaId: 'EMG-004',
    estado: 'REJECTED',
    centroAyudaId: 'CA-TIBABUYES',
    zonaId: 'Bosa',
    tipo: 'Structural collapse',
    solicitadaEn: minutesAgo(18),
    timeoutEn: minutesAgo(14),
    ambulanciasNotificadas: ['A-07', 'A-03', 'A-09', 'A-12', 'A-15'],
    notifiedCount: 5,
    ambulanciaAsignadaId: null,
  },
  {
    id: 'REQ-1005',
    emergenciaId: 'EMG-005',
    estado: 'TIMEOUT',
    centroAyudaId: 'CA-LA-GAITANA',
    zonaId: 'Usaquén',
    tipo: 'Minor fall',
    solicitadaEn: minutesAgo(45),
    timeoutEn: minutesAgo(41),
    ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
    notifiedCount: 3,
    ambulanciaAsignadaId: null,
  },
  {
    id: 'REQ-1006',
    emergenciaId: 'EMG-002',
    estado: 'PENDING',
    centroAyudaId: 'CA-TIBABUYES',
    zonaId: 'Kennedy',
    tipo: 'Traffic collision',
    solicitadaEn: minutesAgo(6),
    timeoutEn: minutesAhead(1),
    ambulanciasNotificadas: ['A-12', 'A-03'],
    notifiedCount: 2,
    ambulanciaAsignadaId: null,
  },
];

/**
 * Demo aid centers from the v2 mockup (`CENTERS()`, lines 535-543). Names are
 * literal; the short marker label is derived from the name (`centerShortName`),
 * not stored twice. The traffic-light level is NEVER set here: it comes from the
 * inventory through `trafficLight`, so each center's worst item produces the
 * mockup's level — Suba Norte critical, La Gaitana alert, Tibabuyes stable.
 */
export const MOCK_CENTROS_AYUDA: CentroAyuda[] = [
  {
    id: 'CA-SUBA-NORTE',
    nombre: 'Acopio Suba Norte',
    ubicacion: { lat: 4.742, lng: -74.09 },
    items: [
      // Worst item: 20/200 = 10% -> RED (the mockup's "Le falta agua potable").
      inventoryItem('INV-SN-1', 'CA-SUBA-NORTE', 'Agua potable', 20, 200, 'singular'),
      inventoryItem('INV-SN-2', 'CA-SUBA-NORTE', 'Alimentos', 180, 200, 'plural'),
      inventoryItem('INV-SN-3', 'CA-SUBA-NORTE', 'Medicamentos básicos', 50, 100, 'plural'),
      inventoryItem('INV-SN-4', 'CA-SUBA-NORTE', 'Cobijas', 120, 100, 'plural'),
    ],
  },
  {
    id: 'CA-LA-GAITANA',
    nombre: 'Acopio La Gaitana',
    ubicacion: { lat: 4.72, lng: -74.05 },
    items: [
      // Worst item: 90/200 = 45% -> AMBER (the mockup's "Le faltan alimentos").
      inventoryItem('INV-LG-1', 'CA-LA-GAITANA', 'Alimentos', 90, 200, 'plural'),
      inventoryItem('INV-LG-2', 'CA-LA-GAITANA', 'Agua potable', 300, 300, 'singular'),
      inventoryItem('INV-LG-3', 'CA-LA-GAITANA', 'Cobijas', 40, 0, 'plural'),
    ],
  },
  {
    id: 'CA-TIBABUYES',
    nombre: 'Acopio Tibabuyes',
    ubicacion: { lat: 4.73, lng: -74.1 },
    items: [
      // Every declared item is above 80% -> GREEN ("Inventario suficiente").
      inventoryItem('INV-TB-1', 'CA-TIBABUYES', 'Agua potable', 500, 500, 'singular'),
      inventoryItem('INV-TB-2', 'CA-TIBABUYES', 'Alimentos', 360, 400, 'plural'),
      inventoryItem('INV-TB-3', 'CA-TIBABUYES', 'Cobijas', 200, 0, 'plural'),
    ],
  },
];
