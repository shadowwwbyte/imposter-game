# 🕵️ Imposter Game

A real-time multiplayer word-based social deduction game with AI-generated word pairs.

## Tech Stack

- **Frontend**: React 18, Tailwind CSS, Zustand, Socket.io-client
- **Backend**: Node.js, Express, Socket.io, PostgreSQL
- **AI**: Google Gemini API (word generation)
- **Auth**: JWT + bcrypt
- **Email**: Nodemailer (SMTP)
- **Infra**: AWS EC2, Nginx, GitHub Actions CI/CD

## Project Structure

```
imposter-game/
├── frontend/          # React app
├── backend/           # Express + Socket.io server
├── nginx/             # Nginx config
├── .github/workflows/ # GitHub Actions CI/CD
├── docker-compose.yml
└── README.md
```

## Quick Start (Local)

```bash
# 1. Clone repo
git clone <your-repo>
cd imposter-game

# 2. Setup environment files (see .env.example files)

# 3. Start with Docker Compose
docker-compose up -d

# OR manually:

# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

## AWS EC2 Deployment

See `docs/DEPLOYMENT.md` for full step-by-step EC2 setup.

## Environment Variables

### Backend (`backend/.env`)
```
PORT=5000
DATABASE_URL=postgresql://user:pass@localhost:5432/imposter_game
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-secret
GEMINI_API_KEY=your-gemini-api-key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

### Frontend (`frontend/.env`)
```
VITE_API_URL=http://localhost:5000/api
VITE_WS_URL=http://localhost:5000
```
