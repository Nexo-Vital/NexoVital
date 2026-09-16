import { trafficLight } from '@/features/recursos/traffic-light';
import type {
  Ambulancia,
  CentroAyuda,
  Emergencia,
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
): InventarioItem {
  return {
    id,
    centroAcopioId,
    nombre,
    disponible,
    requerido,
    semaforo: trafficLight(disponible, requerido),
  };
}

export const MOCK_AMBULANCIAS: Ambulancia[] = [
  {
    id: 'AMB-01',
    placa: 'OVX-101',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.653, lng: -74.062 },
    zona: 'Chapinero',
    driverName: 'Carlos Ramírez',
  },
  {
    id: 'AMB-02',
    placa: 'OVX-102',
    estado: 'EN_ROUTE',
    ubicacion: { lat: 4.598, lng: -74.075 },
    zona: 'Centro',
    driverName: 'Lucía Fernández',
  },
  {
    id: 'AMB-03',
    placa: 'OVX-103',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.702, lng: -74.032 },
    zona: 'Usaquén',
    driverName: 'Andrés Gómez',
  },
  {
    id: 'AMB-04',
    placa: 'OVX-104',
    estado: 'MAINTENANCE',
    ubicacion: { lat: 4.628, lng: -74.148 },
    zona: 'Kennedy',
    driverName: 'Marta Rojas',
  },
  {
    id: 'AMB-05',
    placa: 'OVX-105',
    estado: 'ASSIGNED',
    ubicacion: { lat: 4.742, lng: -74.09 },
    zona: 'Suba',
    driverName: 'Julián Torres',
  },
  {
    id: 'AMB-06',
    placa: 'OVX-106',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.64, lng: -74.09 },
    zona: 'Teusaquillo',
    driverName: 'Paula Cárdenas',
  },
  {
    id: 'AMB-07',
    placa: 'OVX-107',
    estado: 'EN_ROUTE',
    ubicacion: { lat: 4.696, lng: -74.116 },
    zona: 'Engativá',
    driverName: 'Diego Herrera',
  },
  {
    id: 'AMB-08',
    placa: 'OVX-108',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.605, lng: -74.19 },
    zona: 'Bosa',
    driverName: 'Sofía Mendoza',
  },
  {
    id: 'AMB-09',
    placa: 'OVX-109',
    estado: 'MAINTENANCE',
    ubicacion: { lat: 4.66, lng: -74.055 },
    zona: 'Chapinero',
    driverName: 'Óscar Pineda',
  },
  {
    id: 'AMB-10',
    placa: 'OVX-110',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.59, lng: -74.07 },
    zona: 'Centro',
    driverName: 'Valentina Ruiz',
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

export const MOCK_SOLICITUDES: SolicitudAmbulancia[] = [
  {
    id: 'REQ-1001',
    emergenciaId: 'EMG-002',
    estado: 'PENDING',
    centroAyudaId: 'CA-NORTE',
    zonaId: 'Kennedy',
    tipo: 'Traffic collision',
    solicitadaEn: minutesAgo(2),
    timeoutEn: minutesAhead(3),
    ambulanciasNotificadas: ['AMB-01', 'AMB-03', 'AMB-05', 'AMB-06', 'AMB-08', 'AMB-10'],
    notifiedCount: 6,
    ambulanciaAsignadaId: null,
  },
  {
    id: 'REQ-1002',
    emergenciaId: 'EMG-001',
    estado: 'TAKEN',
    centroAyudaId: 'CA-NORTE',
    zonaId: 'Centro',
    tipo: 'Cardiac arrest',
    solicitadaEn: minutesAgo(8),
    timeoutEn: minutesAgo(5),
    ambulanciasNotificadas: ['AMB-02', 'AMB-05', 'AMB-07', 'AMB-10'],
    notifiedCount: 4,
    ambulanciaAsignadaId: 'AMB-05',
  },
  {
    id: 'REQ-1003',
    emergenciaId: 'EMG-003',
    estado: 'CONFIRMED',
    centroAyudaId: 'CA-NORTE',
    zonaId: 'Suba',
    tipo: 'Respiratory distress',
    solicitadaEn: minutesAgo(11),
    timeoutEn: minutesAgo(8),
    ambulanciasNotificadas: ['AMB-02', 'AMB-03', 'AMB-06', 'AMB-07', 'AMB-10'],
    notifiedCount: 5,
    ambulanciaAsignadaId: 'AMB-02',
  },
  {
    id: 'REQ-1004',
    emergenciaId: 'EMG-004',
    estado: 'ASSIGNED',
    centroAyudaId: 'CA-SUR',
    zonaId: 'Bosa',
    tipo: 'Structural collapse',
    solicitadaEn: minutesAgo(18),
    timeoutEn: minutesAgo(14),
    ambulanciasNotificadas: ['AMB-01', 'AMB-04', 'AMB-05', 'AMB-06', 'AMB-07', 'AMB-08', 'AMB-10'],
    notifiedCount: 7,
    ambulanciaAsignadaId: 'AMB-07',
  },
  {
    id: 'REQ-1005',
    emergenciaId: 'EMG-005',
    estado: 'REJECTED',
    centroAyudaId: 'CA-NORTE',
    zonaId: 'Usaquén',
    tipo: 'Minor fall',
    solicitadaEn: minutesAgo(45),
    timeoutEn: minutesAgo(41),
    ambulanciasNotificadas: ['AMB-01', 'AMB-03', 'AMB-06'],
    notifiedCount: 3,
    ambulanciaAsignadaId: null,
  },
  {
    id: 'REQ-1006',
    emergenciaId: 'EMG-002',
    estado: 'TIMEOUT',
    centroAyudaId: 'CA-SUR',
    zonaId: 'Kennedy',
    tipo: 'Traffic collision',
    solicitadaEn: minutesAgo(6),
    timeoutEn: minutesAgo(2),
    ambulanciasNotificadas: ['AMB-04', 'AMB-05', 'AMB-07', 'AMB-08'],
    notifiedCount: 4,
    ambulanciaAsignadaId: null,
  },
];

export const MOCK_CENTROS_AYUDA: CentroAyuda[] = [
  {
    id: 'CA-NORTE',
    nombre: 'Northern Aid Center',
    ubicacion: { lat: 4.742, lng: -74.09 },
    items: [
      inventoryItem('INV-N-1', 'CA-NORTE', 'IV fluids', 120, 200),
      inventoryItem('INV-N-2', 'CA-NORTE', 'Trauma kits', 8, 40),
      inventoryItem('INV-N-3', 'CA-NORTE', 'Oxygen cylinders', 90, 100),
      inventoryItem('INV-N-4', 'CA-NORTE', 'Blankets', 300, 0),
    ],
  },
  {
    id: 'CA-SUR',
    nombre: 'Southern Aid Center',
    ubicacion: { lat: 4.605, lng: -74.19 },
    items: [
      inventoryItem('INV-S-1', 'CA-SUR', 'Analgesics', 45, 100),
      inventoryItem('INV-S-2', 'CA-SUR', 'Surgical masks', 1500, 1000),
      inventoryItem('INV-S-3', 'CA-SUR', 'Defibrillators', 2, 10),
      inventoryItem('INV-S-4', 'CA-SUR', 'Wheelchairs', 12, 0),
    ],
  },
];
