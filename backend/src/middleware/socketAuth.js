const jwt = require('jsonwebtoken');
const { query } = require('../models/db');

const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      'SELECT id, username, avatar_color, status, current_lobby_id FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!rows[0]) {
      return next(new Error('User not found'));
    }

    socket.user = rows[0];
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
};

module.exports = { authenticateSocket };
