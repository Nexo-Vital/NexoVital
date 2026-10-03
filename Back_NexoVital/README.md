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

## Configuración: secreto JWT

En desarrollo local **no hace falta definir nada**: si `NEXOVITAL_JWT_SECRET` no existe, la
aplicación genera un secreto aleatorio en memoria para esa ejecución y lo avisa en el log. Los
tokens dejan de valer al reiniciar.

Con el perfil `prod` el secreto es **obligatorio** y el arranque falla si falta. No existe un
valor fijo en el repositorio a propósito: un secreto comiteado permitiría forjar tokens a
cualquiera con acceso al código. Si se define, debe medir **al menos 32 bytes** (HS256); uno
más corto aborta el arranque en cualquier perfil.

> **Temporal.** La generación automática del secreto es una comodidad de desarrollo y se debe
> retirar antes de salir a producción, para que el secreto vuelva a ser obligatorio en todos los
> perfiles. El detalle de lo pendiente está en el `README.md` de la raíz.

Para fijarlo a mano (obligatorio en `prod`, opcional en local):

```powershell
# PowerShell
$env:NEXOVITAL_JWT_SECRET = (openssl rand -base64 32)
```

```bash
# bash
export NEXOVITAL_JWT_SECRET=$(openssl rand -base64 32)
```

## Ejecución

```bash
mvn spring-boot:run
```

Perfil por defecto: H2 en memoria con `spring.jpa.hibernate.ddl-auto=create-drop`. La decisión
de esquema por perfil (`create-drop` local, `update` docker, `validate` prod) y lo que producción
necesita están documentados en `src/main/resources/application.properties`.

## Usuarios de demostración

`DataSeeder` siembra 10 usuarios que cubren los 5 roles. Solo se activa con los perfiles
`default`, `docker` o `test`, y además exige `nexovital.seed.enabled=true`: **nunca corre en
producción**. Es idempotente, así que reiniciar no duplica cuentas. Las contraseñas se persisten
únicamente como hash BCrypt y nunca se escriben en el log.

| Rol | Email | Contraseña |
|---|---|---|
| `ADMIN_CENTRO_AYUDA` | `rangel@nexovital.co` | `rangel123` |
| `ADMIN_PLATAFORMA` | `admin@nexovital.co` | `admin123` |
| `ADMIN_CENTRO_AYUDA` | `centro@nexovital.co` | `centro123` |
| `ADMIN_ACOPIO` | `acopio@nexovital.co` | `acopio123` |
| `CIUDADANO` | `ciudadano@nexovital.co` | `ciudadano123` |
| `CONDUCTOR` | `conductor1@nexovital.co` … `conductor5@nexovital.co` | `conductor123` |

## API de sesiones

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/sesiones` | Crea una sesión. `200` con `{token, usuario}`; `401` `CREDENCIALES_INVALIDAS`; `423` `CUENTA_BLOQUEADA` + cabecera `Retry-After` (segundos restantes) |
| `GET` | `/api/v1/sesiones/actual` | Usuario de la sesión vigente, resuelto desde el Bearer token. `401` sin token válido |

Tras **3 intentos fallidos seguidos** la cuenta queda bloqueada **5 minutos**. Durante el bloqueo
la contraseña no se evalúa y el contador no se incrementa, de modo que la ventana siempre expira.

## Dimensionamiento del pool de conexiones

**Requisito:** `spring.datasource.hikari.maximum-pool-size` debe ser **al menos el DOBLE** de los
despachos que puedan rechazarse simultáneamente.

**Por qué:** cuando un despacho se rechaza por stock insuficiente
(`POST /api/v1/centros-acopio/{id}/inventario/despacho` → `409`), se registra una **alerta de
escasez** (EP-03.F1.US5) en una **transacción propia** (`REQUIRES_NEW`) que tiene que sobrevivir al
rollback del despacho. La transacción del despacho se suspende pero **conserva su conexión**, así que
**cada rechazo sostiene DOS conexiones a la vez**.

**Valor actual: `40`** (el default era `10`). Se subió porque el escenario de concurrencia **C1**
—*100 solicitudes sobre stock 3*— deja **97 rechazos**, y con el pool viejo la prueba de 16 hilos se
auto-bloqueaba con `Connection is not available (total=10, active=10)`.

**Si producción define el pool por variable de entorno, respetá el doble**, o los rechazos se quedan
sin conexión. La decisión y la alternativa que se evaluó (un listener de `AFTER_ROLLBACK`, que usa
una sola conexión) están en `../odd/tasks/back-225-alerta-escasez.md`, decisión **FA-9**.

## Pruebas

```bash
mvn test
```

### Prueba funcional en vivo (alerta de escasez)

`mvn test` corre los tests *in-process*. Para la **evidencia en vivo** —contra un backend de
verdad, por HTTP— está el script que recorre el ciclo completo del criterio de aceptación de
EP-03.F1.US5:

1. login
2. pedir más unidades de las disponibles → **409 `STOCK_INSUFICIENTE`**
3. el mapa muestra la alerta **sobre el centro**, con el **recurso** y el **faltante**
4. una donación que cubre el faltante
5. el mapa ya no muestra la alerta: **se limpió sola**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prueba-funcional-alerta-escasez.ps1
```

**Requiere el backend corriendo** (si no responde, el script lo dice y sale con código 1). Es
**re-ejecutable**: dona exactamente el faltante que el propio sistema reporta, así que deja el
estado limpio aunque una corrida anterior haya fallado. Sale con **código 0** solo si todos los
pasos pasan.
