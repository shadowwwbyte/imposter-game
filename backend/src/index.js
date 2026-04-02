require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friends');
const chatRoutes = require('./routes/chat');
const lobbyRoutes = require('./routes/lobby');
const lobbyMessagesRoutes = require('./routes/lobbyMessages');
const gameRoutes = require('./routes/game');

const { setupSocketHandlers } = require('./websocket/socketHandlers');
const { authenticateSocket } = require('./middleware/socketAuth');
const { cleanupExpiredAccounts } = require('./utils/cleanup');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 5e6, // 5MB for audio messages
});

// Middleware
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts. Try again later.' },
});
app.use('/api/auth/', authLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/lobby', lobbyRoutes);
app.use('/api/lobby', lobbyMessagesRoutes);
app.use('/api/game', gameRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.io auth middleware
io.use(authenticateSocket);

// Socket handlers
setupSocketHandlers(io);

// Cleanup expired accounts every hour
setInterval(cleanupExpiredAccounts, 60 * 60 * 1000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Imposter Game Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Make io accessible to routes
app.set('io', io);

module.exports = { app, server, io };
