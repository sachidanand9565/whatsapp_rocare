cd /home/ec2-user/whatsapp

# Use npx to ensure next is found
pm2 restart whatsapp || pm2 start npx --name "whatsapp" -- next start -p 3000

# Flow/chatbot queue workers (see workers/*.ts, lib/queue.ts) — run tsx directly
# so no separate build step is needed for these.
pm2 restart whatsapp-flow-worker    || pm2 start npx --name "whatsapp-flow-worker"    -- tsx workers/flow-worker.ts
pm2 restart whatsapp-chatbot-worker || pm2 start npx --name "whatsapp-chatbot-worker" -- tsx workers/chatbot-worker.ts

exit 0
