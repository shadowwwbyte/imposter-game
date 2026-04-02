// Add this GET route to backend/src/routes/lobby.js
// GET /api/lobby/:code/messages
// This is already handled via Socket.io for real-time, but we expose
// a REST endpoint for message history on load.

const express = require('express');
const router = express.Router();
const { query } = require('../models/db');
const { authenticate } = require('../middleware/auth');

// GET /api/lobby/:code/messages
router.get('/:code/messages', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query('SELECT id FROM game_lobbies WHERE code = $1', [req.params.code]);
    if (!lobbyRows[0]) return res.status(404).json({ error: 'Lobby not found' });

    const { rows } = await query(
      `SELECT lm.*,
              u.username AS sender_username,
              u.avatar_color AS sender_avatar,
              r.content AS reply_content,
              r.sender_id AS reply_sender_id,
              ru.username AS reply_sender_username
       FROM lobby_messages lm
       LEFT JOIN users u ON u.id = lm.sender_id
       LEFT JOIN lobby_messages r ON r.id = lm.reply_to_id
       LEFT JOIN users ru ON ru.id = r.sender_id
       WHERE lm.lobby_id = $1
       ORDER BY lm.created_at ASC
       LIMIT 200`,
      [lobbyRows[0].id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
