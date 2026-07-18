# Kill any existing node/next processes
pm2 stop Sk_whatsapp Sk_whatsapp-flow-worker Sk_whatsapp-chatbot-worker 2>/dev/null || true
pm2 delete Sk_whatsapp Sk_whatsapp-flow-worker Sk_whatsapp-chatbot-worker 2>/dev/null || true
pm2 kill 2>/dev/null || true

exit 0
