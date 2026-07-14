# Fix ownership of the app directory
sudo chown -R ec2-user:ec2-user /home/ec2-user/Sk_whatsapp

cd /home/ec2-user/Sk_whatsapp

# Install dependencies
npm install

# Install next locally if not found
npx next build || npm run build

exit 0
