const express = require('express');
const router = express.Router();
const { query } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { generateLobbyCode } = require('../utils/helpers');

// GET /api/lobby - get user's lobbies
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT gl.*, 
              COUNT(lm.id) AS player_count,
              json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar_color', u.avatar_color, 'status', u.status) ORDER BY lm.joined_at) AS players
       FROM game_lobbies gl
       LEFT JOIN lobby_members lm ON lm.lobby_id = gl.id
       LEFT JOIN users u ON u.id = lm.user_id
       WHERE gl.host_id = $1 AND gl.status != 'finished'
       GROUP BY gl.id
       ORDER BY gl.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/lobby - create a new lobby
router.post('/', authenticate, async (req, res) => {
  const { name, maxPlayers = 10, turnTime = 30, wordCategory = 'general' } = req.body;
  try {
    const code = await generateLobbyCode(query);

    const { rows } = await query(
      `INSERT INTO game_lobbies (code, host_id, name, max_players, turn_time, word_category)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code, req.user.id, name || `${req.user.username}'s Game`, maxPlayers, turnTime, wordCategory]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/lobby/:code - get lobby info
router.get('/:code', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT gl.*,
              h.username AS host_username, h.avatar_color AS host_avatar,
              json_agg(json_build_object(
                'id', u.id, 'username', u.username, 'avatar_color', u.avatar_color,
                'status', u.status, 'is_eliminated', lm.is_eliminated,
                'role', CASE WHEN gl.status = 'finished' OR lm.user_id = $2 THEN lm.role ELSE NULL END,
                'assigned_word', CASE WHEN lm.user_id = $2 THEN lm.assigned_word ELSE NULL END
              ) ORDER BY lm.joined_at) FILTER (WHERE u.id IS NOT NULL) AS players
       FROM game_lobbies gl
       JOIN users h ON h.id = gl.host_id
       LEFT JOIN lobby_members lm ON lm.lobby_id = gl.id
       LEFT JOIN users u ON u.id = lm.user_id
       WHERE gl.code = $1
       GROUP BY gl.id, h.username, h.avatar_color`,
      [req.params.code, req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Lobby not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/lobby/:code/join
router.post('/:code/join', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query(
      'SELECT * FROM game_lobbies WHERE code = $1',
      [req.params.code]
    );

    const lobby = lobbyRows[0];
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    if (lobby.status === 'playing') return res.status(400).json({ error: 'Game already in progress' });
    if (lobby.status === 'finished') return res.status(400).json({ error: 'Game has ended' });

    // Check if user is already in a different active (playing) lobby
    const { rows: activeLobby } = await query(
      `SELECT gl.id, gl.code, gl.status FROM lobby_members lm
       JOIN game_lobbies gl ON gl.id = lm.lobby_id
       WHERE lm.user_id = $1 AND gl.status = 'playing' AND gl.id != $2`,
      [req.user.id, lobby.id]
    );

    if (activeLobby[0]) {
      return res.status(400).json({ error: 'You are already in an active game', lobbyCode: activeLobby[0].code });
    }

    // Count members
    const { rows: countRows } = await query(
      'SELECT COUNT(*) FROM lobby_members WHERE lobby_id = $1',
      [lobby.id]
    );

    if (parseInt(countRows[0].count) >= lobby.max_players) {
      return res.status(400).json({ error: 'Lobby is full' });
    }

    // Add member (upsert)
    await query(
      'INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1, $2) ON CONFLICT (lobby_id, user_id) DO NOTHING',
      [lobby.id, req.user.id]
    );

    await query('UPDATE users SET current_lobby_id = $1 WHERE id = $2', [lobby.id, req.user.id]);

    const io = req.app.get('io');
    io.to(`lobby:${lobby.code}`).emit('lobby:playerJoined', {
      userId: req.user.id, username: req.user.username, avatar_color: req.user.avatar_color,
    });

    res.json({ message: 'Joined lobby', lobbyCode: lobby.code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/lobby/:code/leave
router.post('/:code/leave', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query('SELECT * FROM game_lobbies WHERE code = $1', [req.params.code]);
    const lobby = lobbyRows[0];
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

    await query('DELETE FROM lobby_members WHERE lobby_id = $1 AND user_id = $2', [lobby.id, req.user.id]);
    await query('UPDATE users SET current_lobby_id = NULL WHERE id = $1', [req.user.id]);

    const io = req.app.get('io');
    io.to(`lobby:${lobby.code}`).emit('lobby:playerLeft', { userId: req.user.id });

    // If host left and lobby is waiting, maybe delete or transfer host
    if (lobby.host_id === req.user.id && lobby.status === 'waiting') {
      const { rows: remaining } = await query('SELECT user_id FROM lobby_members WHERE lobby_id = $1 LIMIT 1', [lobby.id]);
      if (remaining[0]) {
        await query('UPDATE game_lobbies SET host_id = $1 WHERE id = $2', [remaining[0].user_id, lobby.id]);
        io.to(`lobby:${lobby.code}`).emit('lobby:hostChanged', { newHostId: remaining[0].user_id });
      } else {
        await query("UPDATE game_lobbies SET status = 'finished' WHERE id = $1", [lobby.id]);
      }
    }

    res.json({ message: 'Left lobby' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/lobby/:code/settings (host only)
router.patch('/:code/settings', authenticate, async (req, res) => {
  const { turnTime, maxPlayers, wordCategory, name } = req.body;
  try {
    const { rows } = await query(
      `UPDATE game_lobbies SET 
         turn_time = COALESCE($1, turn_time),
         max_players = COALESCE($2, max_players),
         word_category = COALESCE($3, word_category),
         name = COALESCE($4, name)
       WHERE code = $5 AND host_id = $6 AND status = 'waiting' RETURNING *`,
      [turnTime, maxPlayers, wordCategory, name, req.params.code, req.user.id]
    );

    if (!rows[0]) return res.status(403).json({ error: 'Not authorized or game not in waiting state' });

    const io = req.app.get('io');
    io.to(`lobby:${req.params.code}`).emit('lobby:settingsUpdated', rows[0]);

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
