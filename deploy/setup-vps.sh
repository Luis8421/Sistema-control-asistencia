#!/usr/bin/env bash
# Preparacion inicial de un VPS Ubuntu 24.04 LTS limpio para el Portal de
# Marcacion (FASE 1 + FASE 2 + instalacion de Caddy de la FASE 4).
#
# Ejecutar como root (o con sudo) en el VPS recien contratado, UNA SOLA VEZ.
# No toca nada de esta PC ni de la aplicacion todavia — solo deja el
# sistema operativo listo (Node, PM2, Caddy, firewall).
#
# Uso: copiar este archivo al VPS (scp/pegar contenido) y correr:
#   chmod +x setup-vps.sh && sudo ./setup-vps.sh

set -euo pipefail

echo "=== 1. Actualizando el sistema ==="
apt-get update -y
apt-get upgrade -y

echo "=== 2. Instalando Node.js 20 LTS ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
npm -v

echo "=== 3. Instalando PM2 globalmente ==="
npm install -g pm2
pm2 -v

echo "=== 4. Instalando Caddy ==="
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy
caddy version

echo "=== 5. Configurando UFW (solo SSH, HTTP, HTTPS) ==="
apt-get install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

echo "=== 6. Habilitando actualizaciones de seguridad automaticas ==="
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo ""
echo "=== LISTO ==="
echo "Node, PM2 y Caddy instalados. UFW activo (22/80/443 solamente)."
echo "Siguiente paso: copiar el codigo de la aplicacion (backend/ y web/) a este VPS."
