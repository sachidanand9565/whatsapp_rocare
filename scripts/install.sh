#!/bin/bash
set -e

rm -rf /home/ec2-user/whatsapp-old

cd /home/ec2-user/whatsapp-staging
sudo chown -R ec2-user:ec2-user /home/ec2-user/whatsapp-staging

# .env not in git — copy before build (web app AND workers need it)
cp /home/ec2-user/whatsapp/.env /home/ec2-user/whatsapp-staging/.env

# Redis already installed & running; install only if missing, never fail the deploy
if ! command -v redis-server &>/dev/null && ! command -v redis6-server &>/dev/null; then
  sudo dnf install -y redis6 2>/dev/null || sudo dnf install -y redis 2>/dev/null || echo "WARN: install redis manually"
fi
sudo systemctl enable --now redis6 2>/dev/null || sudo systemctl enable --now redis 2>/dev/null || true

npm ci || npm install
npm run build