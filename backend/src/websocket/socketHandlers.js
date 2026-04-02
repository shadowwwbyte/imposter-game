const { query } = require('../models/db');

// Track online users: userId -> socketId
const onlineUsers = new Map();

const setupSocketHandlers = (io) => {
  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`[Socket] Connected: ${user.username} (${socket.id})`);

    // Register online
    onlineUsers.set(user.id, socket.id);
    socket.join(`user:${user.id}`);

    await query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['online', user.id]);
    io.emit('user:statusChange', { userId: user.id, status: 'online' });

    // Join lobby room if in one
    if (user.current_lobby_id) {
      const { rows } = await query('SELECT code FROM game_lobbies WHERE id = $1', [user.current_lobby_id]);
      if (rows[0]) {
        socket.join(`lobby:${rows[0].code}`);
        socket.emit('lobby:joined', { code: rows[0].code });
      }
    }

    // --- Lobby events ---
    socket.on('lobby:join', async ({ code }) => {
      socket.join(`lobby:${code}`);
      console.log(`[Socket] ${user.username} joined lobby room ${code}`);
    });

    socket.on('lobby:leave', ({ code }) => {
      socket.leave(`lobby:${code}`);
    });

    // --- Lobby chat ---
    socket.on('lobby:message', async ({ code, content, messageType = 'text', audioUrl, replyToId }) => {
      try {
        const { rows: lobbyRows } = await query('SELECT id FROM game_lobbies WHERE code = $1', [code]);
        if (!lobbyRows[0]) return;

        const { rows } = await query(
          `INSERT INTO lobby_messages (lobby_id, sender_id, content, message_type, audio_url, reply_to_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [lobbyRows[0].id, user.id, content, messageType, audioUrl, replyToId || null]
        );

        io.to(`lobby:${code}`).emit('lobby:message', {
          ...rows[0],
          sender_username: user.username,
          sender_avatar: user.avatar_color,
        });
      } catch (err) {
        console.error('Lobby message error:', err);
      }
    });

    socket.on('lobby:reaction', async ({ code, messageId, emoji }) => {
      try {
        const { rows: lobbyRows } = await query('SELECT id FROM game_lobbies WHERE code = $1', [code]);
        if (!lobbyRows[0]) return;

        // Simple reaction add (toggle)
        const { rows: msgRows } = await query('SELECT reactions FROM lobby_messages WHERE id = $1', [messageId]);
        if (!msgRows[0]) return;

        const reactions = msgRows[0].reactions || {};
        if (!reactions[emoji]) reactions[emoji] = [];

        const idx = reactions[emoji].indexOf(user.id);
        if (idx > -1) {
          reactions[emoji].splice(idx, 1);
          if (reactions[emoji].length === 0) delete reactions[emoji];
        } else {
          reactions[emoji].push(user.id);
        }

        await query('UPDATE lobby_messages SET reactions = $1 WHERE id = $2', [JSON.stringify(reactions), messageId]);
        io.to(`lobby:${code}`).emit('lobby:reaction', { messageId, reactions });
      } catch (err) {
        console.error('Lobby reaction error:', err);
      }
    });

    // --- Live audio ---
    socket.on('lobby:audioStream', ({ code, audioChunk }) => {
      socket.to(`lobby:${code}`).emit('lobby:audioStream', {
        userId: user.id, username: user.username, audioChunk,
      });
    });

    socket.on('lobby:audioStreamStart', ({ code }) => {
      socket.to(`lobby:${code}`).emit('lobby:audioStreamStart', {
        userId: user.id, username: user.username,
      });
    });

    socket.on('lobby:audioStreamEnd', ({ code }) => {
      socket.to(`lobby:${code}`).emit('lobby:audioStreamEnd', { userId: user.id });
    });

    // --- User typing indicator ---
    socket.on('chat:typing', ({ receiverId, isTyping }) => {
      io.to(`user:${receiverId}`).emit('chat:typing', { senderId: user.id, isTyping });
    });

    socket.on('lobby:typing', ({ code, isTyping }) => {
      socket.to(`lobby:${code}`).emit('lobby:typing', { userId: user.id, username: user.username, isTyping });
    });

    // --- Connection lost detection ---
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] Disconnected: ${user.username} - ${reason}`);
      onlineUsers.delete(user.id);

      // Check if user is in an active game
      const { rows: activeGame } = await query(
        `SELECT gl.code FROM lobby_members lm
         JOIN game_lobbies gl ON gl.id = lm.lobby_id
         WHERE lm.user_id = $1 AND gl.status = 'playing'`,
        [user.id]
      );

      if (activeGame[0]) {
        // Notify lobby of disconnect
        io.to(`lobby:${activeGame[0].code}`).emit('game:playerDisconnected', {
          userId: user.id,
          username: user.username,
          message: `${user.username} lost internet connection. Consider pausing the game.`,
        });
      }

      await query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['offline', user.id]);
      io.emit('user:statusChange', { userId: user.id, status: 'offline' });
    });

    // --- Reconnect ---
    socket.on('user:reconnect', async ({ code }) => {
      if (code) {
        socket.join(`lobby:${code}`);
        io.to(`lobby:${code}`).emit('game:playerReconnected', {
          userId: user.id, username: user.username,
        });
      }
      await query('UPDATE users SET status = $1 WHERE id = $2', ['online', user.id]);
      io.emit('user:statusChange', { userId: user.id, status: 'online' });
    });
  });
};

module.exports = { setupSocketHandlers, onlineUsers };
