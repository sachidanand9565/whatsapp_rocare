cd /home/ec2-user/Sk_whatsapp

# Use npx to ensure next is found
pm2 restart Sk_whatsapp || pm2 start npx --name "Sk_whatsapp" -- next start -p 3000

exit 0
