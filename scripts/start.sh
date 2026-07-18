#!/bin/bash

cd /home/ec2-user/whatsapp

# Use npx to ensure next is found
pm2 restart whatsapp || pm2 start npx --name "whatsapp" -- next start -p 3000

exit 0