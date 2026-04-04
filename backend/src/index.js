require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const authRoutes  = require('./routes/auth');
const userRoutes  = require('./routes/users');
const friendRoutes = require('./routes/friends');
const chatRoutes  = require('./routes/chat');
const lobbyRoutes = require('./routes/lobby');
const gameRoutes  = require('./routes/game');
// NOTE: lobbyMessages.js is intentionally NOT imported — messages route is in lobby.js

const { setupSocketHandlers } = require('./websocket/socketHandlers');
const { authenticateSocket } = require('./middleware/socketAuth');
const { cleanupExpiredAccounts } = require('./utils/cleanup');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 5e6,
});

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many auth attempts.' } });
app.use('/api/auth/', authLimiter);

app.use('/api/auth',    authRoutes);
app.use('/api/users',   userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/chat',    chatRoutes);
app.use('/api/lobby',   lobbyRoutes);
app.use('/api/game',    gameRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

io.use(authenticateSocket);
setupSocketHandlers(io);

setInterval(cleanupExpiredAccounts, 60 * 60 * 1000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT} | env: ${process.env.NODE_ENV || 'development'}`);
});

app.set('io', io);
module.exports = { app, server, io };
