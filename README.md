# Nexo Vital — Backend

Backend hexagonal modular de **Nexo Vital** (sala de operaciones de emergencias / CRUE).

**ARWS — Arquitecturas de Software · ECI · 2026-2**

## Estado

**Scaffolding.** Este repositorio contiene únicamente la estructura de paquetes de la
arquitectura hexagonal. Los módulos están vacíos: la implementación se desarrolla durante
el sprint del corte.

## Stack

| | |
|---|---|
| Java | 21 |
| Spring Boot | 3.5.16 |
| Persistencia | JPA (H2 en local, PostgreSQL en despliegue) |
| Mensajería | AMQP (RabbitMQ) |
| Tiempo real | WebSocket / STOMP |
| Seguridad | Spring Security + JWT |

## Arquitectura

Monolito modular con arquitectura hexagonal por módulo. Ver
`docs/adr/0003-monolito-modular-hexagonal.md` en el repositorio de documentación.

Cada módulo repite la misma estructura:

```
<modulo>/
├── domain/
│   ├── model/          Entidades y objetos de valor (sin dependencias de framework)
│   ├── port/
│   │   ├── in/         Casos de uso (interfaces que expone el dominio)
│   │   └── out/        Puertos de salida (repositorios, publicadores de eventos)
│   └── ...
├── application/
│   └── usecase/        Implementación de los casos de uso
└── infrastructure/
    └── adapter/
        ├── in/         Adaptadores de entrada (controladores REST, consumidores)
        └── out/        Adaptadores de salida (JPA, AMQP, STOMP)
```

### Módulos

| Módulo | Responsabilidad |
|---|---|
| `usuarios` | Registro, autenticación y organizaciones |
| `mapa` | Zonas afectadas, centros y puntos de entrega |
| `recursos` | Inventario, solicitudes, donaciones y semáforo |
| `flota` | Ambulancias, posiciones y asignación por broadcast |
| `observabilidad` | Bitácora de eventos y KPIs |
| `gateway` | Puente de eventos hacia los canales de tiempo real |
| `shared` | Tipos y contratos compartidos entre módulos |
| `infrastructure` | Configuración transversal (seguridad, mensajería, datos) |

## Reglas de arquitectura

- **El servidor es la única fuente de verdad.** Ninguna decisión de asignación se resuelve en el cliente.
- **Los invariantes se garantizan por construcción**, con operaciones atómicas en base de datos. Nunca con bloqueos en memoria ni banderas en el cliente.
- **El disparador de un evento es el servicio que ejecuta la transacción**, nunca el frontend.
- El dominio no depende de Spring ni de JPA. Las dependencias apuntan hacia adentro.

## Requisitos

- JDK 21
- Maven 3.9+

## Ejecución

```bash
mvn spring-boot:run
```

## Pruebas

```bash
mvn test
```
