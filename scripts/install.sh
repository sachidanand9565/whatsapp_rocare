# Fix ownership of the app directory
sudo chown -R ec2-user:ec2-user /home/ec2-user/whatsapp

cd /home/ec2-user/whatsapp

npm install

npx next build || npm run build

# ---- Redis (for the BullMQ flow/chatbot queues) ----
# Installed locally on this same instance — single-EC2 deployment, no need for
# a separate managed Redis. Best-effort across Amazon Linux 2 / 2023; does not
# fail the deploy if the package name differs on your AMI (verify manually then).
if ! command -v redis-server &> /dev/null; then
  sudo dnf install -y redis6 2>/dev/null \
    || sudo dnf install -y redis 2>/dev/null \
    || sudo amazon-linux-extras install -y redis6 2>/dev/null \
    || sudo yum install -y redis 2>/dev/null \
    || echo "WARNING: could not auto-install redis-server — install it manually before workers will connect"
fi
sudo systemctl enable --now redis6 2>/dev/null \
  || sudo systemctl enable --now redis 2>/dev/null \
  || echo "WARNING: could not start redis service — check manually (systemctl status redis / redis6)"

exit 0
