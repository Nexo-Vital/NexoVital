# syntax=docker/dockerfile:1
# ==========================================================================
# Imagen del frontend de NexoVital.
#
# Dos etapas:
#   1. build   : Node instala dependencias y genera el sitio estatico (dist/).
#   2. runtime : Nginx sirve dist/ y reenvia /api y /ws al backend.
#
# El front llama a rutas relativas (/api/v1 y /ws), asi que la imagen no lleva
# ninguna URL del backend "quemada": Nginx la recibe al arrancar en la variable
# BACKEND_URL. La misma imagen sirve en local y en la nube.
# ==========================================================================

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Dentro de la imagen no hay repositorio git: se desactivan los hooks de husky.
ENV HUSKY=0

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Build contra el backend real, nunca en modo demo (el modo demo es solo para el
# despliegue estatico de Cloudflare, que no tiene backend).
ENV VITE_DEMO_MODE=0
RUN npm run build


FROM nginx:stable-alpine AS runtime

# La imagen oficial de Nginx reemplaza las variables de entorno de los archivos
# *.template al arrancar y deja el resultado en /etc/nginx/conf.d/.
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# Valor para docker-compose; en la nube se sobreescribe. Sin barra al final.
ENV BACKEND_URL=http://backend:8080

EXPOSE 80
