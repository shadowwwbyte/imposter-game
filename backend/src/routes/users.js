const express = require('express');
const router = express.Router();
const { query } = require('../models/db');
const { authenticate } = require('../middleware/auth');

// GET /api/users/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, email, is_temporary, email_verified, avatar_color, status,
              total_games, games_won, times_imposter, imposter_wins, created_at, expires_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:username
router.get('/:username', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, avatar_color, status, total_games, games_won, times_imposter, imposter_wins, created_at
       FROM users WHERE username = $1`,
      [req.params.username.toLowerCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/me
router.patch('/me', authenticate, async (req, res) => {
  const { avatarColor } = req.body;
  try {
    const { rows } = await query(
      'UPDATE users SET avatar_color = COALESCE($1, avatar_color) WHERE id = $2 RETURNING id, username, avatar_color',
      [avatarColor, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/me/lobbies
router.get('/me/lobbies', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT gl.id, gl.code, gl.name, gl.status, gl.max_players, gl.turn_time, gl.created_at,
              COUNT(lm.id) AS player_count
       FROM game_lobbies gl
       LEFT JOIN lobby_members lm ON lm.lobby_id = gl.id
       WHERE gl.host_id = $1 AND gl.status != 'finished'
       GROUP BY gl.id ORDER BY gl.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
