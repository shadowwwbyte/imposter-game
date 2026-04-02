# 🚀 AWS EC2 Deployment Guide — Imposter Game

## Prerequisites
- AWS account
- EC2 instance (Ubuntu 22.04 LTS recommended, t3.small or larger)
- Domain name (optional but recommended)
- GitHub repository with this code

---

## Step 1: Launch EC2 Instance

1. Go to AWS EC2 Console → Launch Instance
2. **AMI**: Ubuntu Server 22.04 LTS
3. **Instance type**: t3.small (2 vCPU, 2GB RAM) minimum
4. **Key pair**: Create or use existing `.pem` key
5. **Security Group** — Open these ports:
   - 22 (SSH) — your IP only
   - 80 (HTTP) — 0.0.0.0/0
   - 443 (HTTPS) — 0.0.0.0/0
6. **Storage**: 20GB gp3
7. Launch instance, note the Public IP

---

## Step 2: Server Setup (run once on EC2)

SSH into your instance:
```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

### 2a. Update and install dependencies
```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Nginx
sudo apt install -y nginx

# PM2 (process manager)
sudo npm install -g pm2

# Git
sudo apt install -y git

# (Optional) Certbot for HTTPS
sudo apt install -y certbot python3-certbot-nginx
```

### 2b. Setup PostgreSQL
```bash
sudo -u postgres psql << 'EOF'
CREATE USER imposter_user WITH PASSWORD 'your-strong-password';
CREATE DATABASE imposter_game OWNER imposter_user;
GRANT ALL PRIVILEGES ON DATABASE imposter_game TO imposter_user;
\q
EOF

# Run schema
sudo -u postgres psql -d imposter_game -f /var/www/imposter-game/backend/src/models/schema.sql
```

### 2c. Create app directory
```bash
sudo mkdir -p /var/www/imposter-game/{backend,frontend/dist}
sudo chown -R ubuntu:ubuntu /var/www/imposter-game
```

### 2d. Setup environment file
```bash
cat > /var/www/imposter-game/backend/.env << 'EOF'
PORT=5000
NODE_ENV=production
DATABASE_URL=postgresql://imposter_user:your-strong-password@localhost:5432/imposter_game
JWT_SECRET=generate-a-very-long-random-string-here
JWT_REFRESH_SECRET=another-very-long-random-string-here
GEMINI_API_KEY=your-gemini-api-key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-gmail-app-password
FRONTEND_URL=http://YOUR_EC2_IP
EOF
```

**Generate secure secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 2e. Configure Nginx
```bash
sudo cp /var/www/imposter-game/nginx/imposter-game.conf /etc/nginx/sites-available/imposter-game
sudo ln -s /etc/nginx/sites-available/imposter-game /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 2f. Setup PM2 with startup
```bash
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Run the command that PM2 outputs
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

### 2g. Allow ubuntu user to reload nginx (for CI/CD)
```bash
echo "ubuntu ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /bin/systemctl reload nginx, /bin/systemctl restart nginx" | \
  sudo tee /etc/sudoers.d/ubuntu-nginx
```

---

## Step 3: GitHub Actions Secrets

In your GitHub repo → Settings → Secrets → Actions → Add:

| Secret Name | Value |
|---|---|
| `EC2_HOST` | Your EC2 Public IP or domain |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_PRIVATE_KEY` | Contents of your `.pem` key file |
| `VITE_API_URL` | `http://YOUR_EC2_IP/api` |
| `VITE_WS_URL` | `http://YOUR_EC2_IP` |

---

## Step 4: First Manual Deploy

Before GitHub Actions takes over, deploy manually once:

```bash
# On your LOCAL machine:
cd imposter-game

# Build frontend
cd frontend && npm install && VITE_API_URL=http://YOUR_EC2_IP/api VITE_WS_URL=http://YOUR_EC2_IP npm run build && cd ..

# Sync to EC2
rsync -avz --exclude 'node_modules' --exclude '.env' backend/ ubuntu@YOUR_EC2_IP:/var/www/imposter-game/backend/
rsync -avz frontend/dist/ ubuntu@YOUR_EC2_IP:/var/www/imposter-game/frontend/dist/

# SSH in and start
ssh ubuntu@YOUR_EC2_IP
cd /var/www/imposter-game/backend
npm ci --only=production
# Run schema if first time:
psql $DATABASE_URL -f src/models/schema.sql

pm2 start src/index.js --name imposter-backend --env production
pm2 save

# Test
curl http://localhost/health
```

---

## Step 5: Setup HTTPS (Optional but Recommended)

```bash
# Replace example.com with your domain
sudo certbot --nginx -d example.com -d www.example.com

# Auto-renew
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Update .env
sed -i 's|FRONTEND_URL=.*|FRONTEND_URL=https://example.com|' /var/www/imposter-game/backend/.env
pm2 restart imposter-backend
```

---

## Step 6: Verify Deployment

```bash
# Check backend process
pm2 status
pm2 logs imposter-backend --lines 50

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Check PostgreSQL
sudo systemctl status postgresql

# Health check
curl http://YOUR_EC2_IP/health
# Should return: {"status":"ok","timestamp":"..."}
```

---

## Ongoing Deployments (CI/CD)

After setup, every push to `main` branch will:
1. Install dependencies
2. Build frontend with correct env vars
3. Sync files to EC2 via rsync over SSH
4. Install production deps on EC2
5. Restart PM2 process
6. Reload Nginx
7. Run a health check

Push to main → deployed in ~2-3 minutes automatically! 🚀

---

## Monitoring & Logs

```bash
# Live logs
pm2 logs imposter-backend

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log

# Disk usage
df -h

# Memory/CPU
pm2 monit
```

---

## Troubleshooting

**WebSocket not connecting?**
- Check Nginx `location /socket.io` block has `Upgrade` headers
- Ensure Security Group has port 80/443 open

**Database connection failed?**
- `sudo systemctl status postgresql`
- Check DATABASE_URL in .env

**PM2 process keeps crashing?**
- `pm2 logs imposter-backend --lines 100`
- Check .env file exists and has all required vars

**GitHub Actions SSH fails?**
- Ensure EC2_SSH_PRIVATE_KEY includes the full key with headers
- Test: `ssh -i key.pem ubuntu@EC2_IP echo ok`
