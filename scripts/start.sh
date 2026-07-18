cd /home/ec2-user/Sk_whatsapp

# Use npx to ensure next is found
pm2 restart Sk_whatsapp || pm2 start npx --name "Sk_whatsapp" -- next start -p 3000

# Flow/chatbot queue workers (see workers/*.ts, lib/queue.ts) — run tsx directly
# so no separate build step is needed for these.
pm2 restart Sk_whatsapp-flow-worker    || pm2 start npx --name "Sk_whatsapp-flow-worker"    -- tsx workers/flow-worker.ts
pm2 restart Sk_whatsapp-chatbot-worker || pm2 start npx --name "Sk_whatsapp-chatbot-worker" -- tsx workers/chatbot-worker.ts

exit 0
