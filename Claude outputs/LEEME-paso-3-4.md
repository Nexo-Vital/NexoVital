# LEEME · Pasos 3 y 4 del Sprint 2

**Alcance:** nginx y F2.US3, límites con 429 (T03, T18); y F1.US1, disponibilidad (T04, T06).

**Estado:** los cambios ya están aplicados en tu carpeta local, en la rama `Sprint2` y sin commit. No creé ninguna carpeta en el proyecto.

## 0. Qué se nota solo en un entorno real

| Cambio | Localhost (`npm run dev` + `spring-boot:run`) | `docker compose` (2 backends + nginx + RabbitMQ) | Azure |
|---|---|---|---|
| H3 · `deploy/nginx/nginx.conf`: X-Forwarded-For no falseable | No se nota, porque no hay nginx | **Aquí se prueba** | No aplica: Azure no usa este archivo |
| H4 · nginx solo publica `/actuator/health` | No se nota | **Aquí se prueba** | No aplica |
| H3 en Azure · `Front_NexoVital/docker/nginx/default.conf.template` | No se nota | No se nota (en el compose el `/api` no pasa por el nginx del front) | ⚠️ **Solo se nota en Azure**, después de que llegue a `main` (ver sección 4) |
| H9 · si RabbitMQ cae, el push se entrega local | No se nota, porque en local no hay broker | **Aquí se prueba** | No se nota: Azure tiene un solo backend |
| H11 · reconexión del cliente cada 2 s | Se nota poco | **Aquí se prueba** (tumbando un backend) | Se nota igual, sin hacer nada |

Para las pruebas de nginx y de RabbitMQ necesitas **Docker Desktop** abierto en tu Mac. Sin Docker solo puedes hacer el paso 2.1.

## 1. Qué cambió

### T03 y T18 · nginx y límite por IP

| Archivo | Cambio | Por qué |
|---|---|---|
| `deploy/nginx/nginx.conf` | En `/api/` y `/ws`, `X-Forwarded-For $proxy_add_x_forwarded_for` pasa a `X-Forwarded-For $remote_addr` | El limitador toma la primera IP de esa cabecera. Antes, un script podía mandar `X-Forwarded-For: 1.2.3.4`, inventar una IP en cada petición y no topar nunca el límite de 60/min por IP. Ahora nginx reemplaza la cabecera con la IP real. |
| `deploy/nginx/nginx.conf` | `location /actuator/` pasa a `location ~ ^/actuator/health(/.*)?$`, y cualquier otro `/actuator/...` responde **404** | `/actuator/prometheus` estaba publicado en el puerto 8080 del host. Prometheus lo sigue leyendo directo de cada backend por la red interna. |
| `Front_NexoVital/docker/nginx/default.conf.template` | Se agrega `realip`: confía en las IP privadas de la red de Azure, toma la IP pública que agrega el ingress y reenvía solo esa | Es la misma corrección para Azure. Ahí el `/api` pasa por el nginx del front. |
| `LimiteSolicitudesInterceptor` | Solo Javadoc: documenta que la primera IP es confiable solo porque el proxy reemplaza la cabecera | Para que nadie vuelva a poner `$proxy_add_x_forwarded_for` sin saber lo que rompe. |

### T04 · Eventos por RabbitMQ

| Archivo | Cambio |
|---|---|
| `PushFanOutAdapter` | Si publicar en RabbitMQ falla (`AmqpException`), el evento se entrega a los clientes de **esta** instancia y se registra `push_degradado instancia=… destino=… consecutivo=… motivo=…`. Antes se perdía para todos sin dejar rastro. |
| `PushFanOutAdapterTest` | Prueba nueva, `siRabbitMqNoRespondeElEventoSeEntregaLocalYNoSePierde`. |

### T06 · Reconexión

| Archivo | Cambio |
|---|---|
| `stomp-adapter.ts` | `RECONNECT_DELAY_MS` baja de 5000 a **2000** ms. Así sobra margen para la medida D-1, que pide reconectar y recuperar el estado en menos de 10 s. |

`docs/matriz-permisos.md` también se actualizó: la nota sobre `/actuator/prometheus` ahora dice que ya está cerrado.

## 2. Cómo probarlo

### 2.1 Pruebas automáticas (sin Docker)

```bash
cd ~/"Documents/Universidad/Programacion/7mo Semestre/ARSW/Proyecto/NexoVital/Back_NexoVital"
./mvnw test -Dtest='PushFanOutAdapterTest,LimiteHttpTest'
./mvnw test        # la suite completa
```

**Deberías ver:** `BUILD SUCCESS` y `Failures: 0, Errors: 0`. `PushFanOutAdapterTest` debe mostrar una prueba más que antes.

```bash
cd ../Front_NexoVital
npm run lint
npx vitest run src/shared/realtime
```

**Deberías ver:** el lint sin errores y `Tests 60 passed`. Yo ya corrí ambos y pasan.

### 2.2 Levantar la topología completa (Docker)

```bash
cd ~/"Documents/Universidad/Programacion/7mo Semestre/ARSW/Proyecto/NexoVital"
docker compose up -d --build
docker compose ps
```

**Deberías ver:** `nginx`, `backend-1`, `backend-2`, `rabbitmq`, `db`, `frontend`, `prometheus` y `grafana` en estado `running`. Los dos backends deben estar `healthy`; tardan unos 40 s.

### 2.3 Prueba H4: solo la salud es pública

```bash
curl -i http://localhost:8080/actuator/health
curl -i http://localhost:8080/actuator/prometheus
curl -i http://localhost:8080/actuator/info
```

**Deberías ver:**
1. `HTTP/1.1 200` con `{"status":"UP"}` y una cabecera `X-Upstream`. Si repites, alterna entre los dos backends.
2. `HTTP/1.1 404`. Antes devolvía cientos de líneas de métricas.
3. `HTTP/1.1 404`.

**Que Prometheus siga funcionando:** abre http://localhost:9090/targets. Los dos objetivos de `nexovital-backend` deben estar **UP** en verde.

### 2.4 Prueba H3: no se puede inventar la IP

```bash
for ip in 1.1.1.1 2.2.2.2 3.3.3.3; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/v1/solicitudes/mias -H "X-Forwarded-For: $ip"
done
docker compose logs backend-1 backend-2 | grep autenticacion_fallida | tail -3
```

**Deberías ver:** tres `401`. En las tres líneas del log, `ip=` debe mostrar **la misma IP**: la de Docker, algo como `172.18.0.1` o `192.168.65.1`. **Nunca** `1.1.1.1`, `2.2.2.2` ni `3.3.3.3`. Antes del cambio salían las IP inventadas, que es justo lo que permitía evadir el límite.

### 2.5 Prueba T18: el 429 sigue funcionando

El límite por usuario no cambia. En el navegador:

1. Entra a http://localhost:8080 como ciudadano.
2. Reporta emergencias seguidas: más de 10 en menos de un minuto.

**Deberías ver:** a partir de la 11.ª, el mensaje "Has hecho demasiadas solicitudes…". En el log aparece:

```bash
docker compose logs backend-1 backend-2 | grep limite_excedido | tail -2
# limite_excedido actor=<id> ip=172.x.x.x recurso=EMERGENCIA ...
```

La `ip` debe ser la real de Docker, no una inventada.

### 2.6 Prueba T04: RabbitMQ se cae y el mapa no se congela

1. Abre http://localhost:8080 y entra con cualquier usuario. Las ambulancias del mapa se mueven solas cada 5 s, porque la simulación está activa.
2. Apaga RabbitMQ:

   ```bash
   docker compose stop rabbitmq
   docker compose logs -f backend-1 backend-2 | grep push_degradado
   ```

**Deberías ver:**
- Cada ~5 s, una línea `push_degradado instancia=backend-X destino=/topic/flota consecutivo=… motivo=AmqpConnectException` (o `AmqpIOException`).
- También aparecerán errores de reconexión de Spring AMQP. Son esperados: el backend intenta volver a conectarse.
- **En el navegador:** si tu pestaña está conectada a la misma instancia que corre la simulación, las ambulancias **siguen moviéndose**. Antes se congelaban. Si estás conectado a la otra instancia, recarga la página: el mapa se relee del backend y queda al día.

3. Vuelve a encender RabbitMQ:

   ```bash
   docker compose start rabbitmq
   ```

   A los pocos segundos dejan de salir los `push_degradado` y los eventos vuelven a llegar a las dos instancias.

### 2.7 Prueba T06: se cae un backend y el cliente se reconecta rápido

1. Con el mapa abierto en http://localhost:8080, abre DevTools (⌥⌘I), pestaña **Network**, filtro **WS**. Verás una conexión `websocket` abierta.
2. Apaga un backend:

   ```bash
   docker compose stop backend-2
   ```

   Si tu WebSocket estaba en `backend-1`, no pasa nada; repite con `docker compose stop backend-1` después de encender `backend-2`.

**Deberías ver:** la conexión WS se cierra y aparece una nueva **en unos 2 a 3 segundos**. Antes tardaba 5 s o más. El mapa vuelve a mostrar las ambulancias moviéndose y no se pierde ninguna emergencia.

3. Enciende de nuevo: `docker compose start backend-2`.

Al terminar: `docker compose down`. Así se conservan los datos; con `-v` se borran.

## 3. Commit

```bash
cd ~/"Documents/Universidad/Programacion/7mo Semestre/ARSW/Proyecto/NexoVital"
git add deploy/nginx/nginx.conf Front_NexoVital/docker/nginx/default.conf.template \
        Front_NexoVital/src/shared/realtime/stomp-adapter.ts Back_NexoVital/src docs/matriz-permisos.md
git status
git commit -m "fix(disponibilidad,limites): X-Forwarded-For no falseable, actuator cerrado, fallback si RabbitMQ cae y reconexion en 2 s (T03, T04, T06, T18)"
```

## 4. ⚠️ Azure: lo que hay que hacer y verificar

El único cambio que afecta Azure es `Front_NexoVital/docker/nginx/default.conf.template`. **No hay que tocar nada a mano en Azure.** El CD (`cd.yml`) despliega solo cuando el CI de un push a `main` termina bien.

1. Cuando este cambio llegue a `main` (merge de `Sprint2` → `main`), espera a que termine **CD** en GitHub Actions. En el resumen del run debe decir "Front OK" y "Back OK".
2. **Verifica que la IP no se pueda inventar en Azure.** Reemplaza `<FRONT>` por la URL del front, que aparece en el resumen del CD como "Sitio":

   ```bash
   curl -s https://ifconfig.me ; echo      # tu IP pública real
   curl -s -o /dev/null -w "%{http_code}\n" https://<FRONT>/api/v1/solicitudes/mias -H "X-Forwarded-For: 6.6.6.6"
   az containerapp logs show -g <grupo> -n <app-del-back> --tail 50 | grep autenticacion_fallida
   ```

   **Deberías ver:** `401` y, en el log, `ip=<tu IP pública real>`, **no** `ip=6.6.6.6`.

3. **Si en el log sale una IP privada** (`10.x`, `100.x` o `172.x`) **para todos los usuarios**, el ingress de Azure no está agregando la IP del cliente como se espera. Avísame antes de seguir: en ese caso el límite por IP trataría a todos como uno solo. Antes de este cambio pasaba lo mismo, así que no se rompe nada que funcionara. El cambio es seguro aunque Azure no se comporte como se espera, pero hay que confirmarlo.

4. **Revisa si el back está expuesto directo a internet:**

   ```bash
   az containerapp show -g <grupo> -n <app-del-back> --query properties.configuration.ingress.external
   ```

   - Si dice `false`, perfecto: solo el front llega al back.
   - Si dice `true`, el back recibe tráfico sin pasar por el nginx del front. Entonces `/actuator/prometheus` es público en Azure, y alguien podría falsear la IP llamando al back directo. Lo recomendado es cambiar el ingress del back a interno:

     ```bash
     az containerapp ingress update -g <grupo> -n <app-del-back> --type internal
     ```

     Hazlo **solo** si `BACKEND_URL` del front apunta al FQDN interno. Si no, el front pierde el back. Si dice `true`, mándame la salida y te digo cómo dejarlo bien.

## 5. Lo que no entra en este paso

- **Heartbeats del servidor STOMP.** El broker simple no los envía. Si una instancia se **congela** sin cerrar la conexión, el cliente tarda en notarlo. La prueba D-1 usa `docker stop`, que sí cierra la conexión, así que no afecta T07.
