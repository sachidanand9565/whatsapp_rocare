#!/bin/bash
set -e

cd /home/ec2-user

# Swap staging into place; keep old build as rollback
[ -d whatsapp ] && mv whatsapp whatsapp-old
mv whatsapp-staging whatsapp
cd /home/ec2-user/whatsapp

# ---- WEB APP: blue-green port flip (zero downtime) ----
CURRENT=$(grep -oP '\d+' /etc/nginx/active_port.conf)
if [ "$CURRENT" = "3000" ]; then NEW=3001; else NEW=3000; fi
echo "Web active port $CURRENT — booting new web on $NEW"

pm2 delete "whatsapp-$NEW" 2>/dev/null || true
PORT=$NEW pm2 start npm --name "whatsapp-$NEW" -- start

# Wait until new web port answers before flipping
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$NEW" >/dev/null; then echo "Web up on $NEW"; break; fi
  [ "$i" = "30" ] && { echo "Web failed on $NEW — aborting"; pm2 delete "whatsapp-$NEW" 2>/dev/null || true; exit 1; }
  echo "waiting for web $NEW... ($i)"; sleep 1
done

# Flip nginx to new web port
echo "set \$active_port $NEW;" | sudo tee /etc/nginx/active_port.conf
sudo nginx -s reload

# Retire old web version
sleep 3
pm2 delete "whatsapp-$CURRENT" 2>/dev/null || true

# ---- WORKERS: restart on new code (brief gap; BullMQ re-queues jobs in Redis) ----
pm2 delete whatsapp-flow-worker 2>/dev/null || true
pm2 delete whatsapp-chatbot-worker 2>/dev/null || true
pm2 start npm --name whatsapp-flow-worker -- run worker:flow
pm2 start npm --name whatsapp-chatbot-worker -- run worker:chatbot

pm2 save
echo "Web on $NEW; workers restarted from new code."