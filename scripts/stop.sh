# Kill any existing node/next processes
pm2 stop whatsapp whatsapp-flow-worker whatsapp-chatbot-worker 2>/dev/null || true
pm2 delete whatsapp whatsapp-flow-worker whatsapp-chatbot-worker 2>/dev/null || true
pm2 kill 2>/dev/null || true

exit 0
