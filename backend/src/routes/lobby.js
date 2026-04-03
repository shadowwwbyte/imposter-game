const express = require('express');
const router = express.Router();
const { query } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { generateLobbyCode } = require('../utils/helpers');

// ── GET /api/lobby/mine — all lobbies the user belongs to (member or host) ──
router.get('/mine', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT gl.*,
              h.username AS host_username, h.avatar_color AS host_avatar,
              COUNT(lm2.id) AS player_count,
              json_agg(
                json_build_object(
                  'id', u.id, 'username', u.username,
                  'avatar_color', u.avatar_color, 'status', u.status
                ) ORDER BY lm2.joined_at
              ) FILTER (WHERE u.id IS NOT NULL) AS players
       FROM lobby_members lm
       JOIN game_lobbies gl ON gl.id = lm.lobby_id
       JOIN users h ON h.id = gl.host_id
       LEFT JOIN lobby_members lm2 ON lm2.lobby_id = gl.id
       LEFT JOIN users u ON u.id = lm2.user_id
       WHERE lm.user_id = $1 AND gl.status != 'discarded'
       GROUP BY gl.id, h.username, h.avatar_color
       ORDER BY
         CASE gl.status
           WHEN 'playing' THEN 0
           WHEN 'paused'  THEN 1
           WHEN 'waiting' THEN 2
           ELSE 3
         END,
         gl.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/lobby/:code — single lobby info ────────────────────────────────
router.get('/:code', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT gl.*,
              h.username AS host_username, h.avatar_color AS host_avatar,
              json_agg(json_build_object(
                'id', u.id, 'username', u.username, 'avatar_color', u.avatar_color,
                'status', u.status, 'is_eliminated', lm.is_eliminated,
                'role', CASE WHEN gl.status IN ('waiting','discarded') OR lm.user_id = $2 THEN lm.role ELSE NULL END,
                'assigned_word', CASE WHEN lm.user_id = $2 THEN lm.assigned_word ELSE NULL END
              ) ORDER BY lm.joined_at) FILTER (WHERE u.id IS NOT NULL) AS players
       FROM game_lobbies gl
       JOIN users h ON h.id = gl.host_id
       LEFT JOIN lobby_members lm ON lm.lobby_id = gl.id
       LEFT JOIN users u ON u.id = lm.user_id
       WHERE gl.code = $1 AND gl.status != 'discarded'
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

// ── POST /api/lobby — create lobby ─────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { name, maxPlayers = 10, turnTime = 30, wordCategory = 'general' } = req.body;
  try {
    const code = await generateLobbyCode(query);
    const { rows } = await query(
      `INSERT INTO game_lobbies (code, host_id, name, max_players, turn_time, word_category)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [code, req.user.id, name || `${req.user.username}'s Lobby`, maxPlayers, turnTime, wordCategory]
    );

    // Auto-join the creator as a member
    await query(
      'INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [rows[0].id, req.user.id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/lobby/:code/join ───────────────────────────────────────────────
router.post('/:code/join', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query(
      "SELECT * FROM game_lobbies WHERE code = $1 AND status != 'discarded'",
      [req.params.code]
    );
    const lobby = lobbyRows[0];
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

    // Can join a waiting lobby freely
    // Can rejoin a playing/paused lobby only if already a member
    const { rows: existingMember } = await query(
      'SELECT id FROM lobby_members WHERE lobby_id = $1 AND user_id = $2',
      [lobby.id, req.user.id]
    );

    if (lobby.status === 'playing' && !existingMember[0]) {
      return res.status(400).json({ error: 'Game already in progress — cannot join mid-game' });
    }
    if (lobby.status === 'paused' && !existingMember[0]) {
      return res.status(400).json({ error: 'Game is paused — cannot join mid-game' });
    }

    // Check capacity (only for new joins to waiting lobbies)
    if (!existingMember[0]) {
      const { rows: [{ count }] } = await query(
        'SELECT COUNT(*) FROM lobby_members WHERE lobby_id = $1',
        [lobby.id]
      );
      if (parseInt(count) >= lobby.max_players) {
        return res.status(400).json({ error: 'Lobby is full' });
      }
      await query(
        'INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1, $2)',
        [lobby.id, req.user.id]
      );
    }

    const io = req.app.get('io');
    if (!existingMember[0]) {
      io.to(`lobby:${lobby.code}`).emit('lobby:playerJoined', {
        userId: req.user.id, username: req.user.username, avatar_color: req.user.avatar_color,
      });
    }

    res.json({ message: 'Joined lobby', lobbyCode: lobby.code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/lobby/:code/leave — leave (but lobby persists) ────────────────
router.post('/:code/leave', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query(
      "SELECT * FROM game_lobbies WHERE code = $1 AND status != 'discarded'",
      [req.params.code]
    );
    const lobby = lobbyRows[0];
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

    // Can't leave an active game — must pause first or the game handles it
    if (lobby.status === 'playing') {
      return res.status(400).json({ error: 'Game is in progress. Pause the game before leaving.' });
    }

    await query('DELETE FROM lobby_members WHERE lobby_id = $1 AND user_id = $2', [lobby.id, req.user.id]);

    const io = req.app.get('io');
    io.to(`lobby:${lobby.code}`).emit('lobby:playerLeft', { userId: req.user.id });

    // If host left, transfer host to next member or discard if empty
    if (lobby.host_id === req.user.id) {
      const { rows: remaining } = await query(
        'SELECT user_id FROM lobby_members WHERE lobby_id = $1 ORDER BY joined_at LIMIT 1',
        [lobby.id]
      );
      if (remaining[0]) {
        await query('UPDATE game_lobbies SET host_id = $1 WHERE id = $2', [remaining[0].user_id, lobby.id]);
        io.to(`lobby:${lobby.code}`).emit('lobby:hostChanged', { newHostId: remaining[0].user_id });
      } else {
        // No members left — discard the lobby
        await query("UPDATE game_lobbies SET status = 'discarded' WHERE id = $1", [lobby.id]);
      }
    }

    res.json({ message: 'Left lobby' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/lobby/:code — host explicitly discards the lobby ─────────────
router.delete('/:code', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE game_lobbies SET status = 'discarded' WHERE code = $1 AND host_id = $2 AND status NOT IN ('playing') RETURNING id, code",
      [req.params.code, req.user.id]
    );
    if (!rows[0]) return res.status(403).json({ error: 'Not authorized or game is in progress' });

    const io = req.app.get('io');
    io.to(`lobby:${req.params.code}`).emit('lobby:discarded', {
      message: 'This lobby has been discarded by the host.',
    });

    res.json({ message: 'Lobby discarded' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/lobby/:code/settings — host only ─────────────────────────────
router.patch('/:code/settings', authenticate, async (req, res) => {
  const { turnTime, maxPlayers, wordCategory, name } = req.body;
  try {
    const { rows } = await query(
      `UPDATE game_lobbies SET
         turn_time    = COALESCE($1, turn_time),
         max_players  = COALESCE($2, max_players),
         word_category = COALESCE($3, word_category),
         name         = COALESCE($4, name)
       WHERE code = $5 AND host_id = $6 AND status = 'waiting' RETURNING *`,
      [turnTime, maxPlayers, wordCategory, name, req.params.code, req.user.id]
    );
    if (!rows[0]) return res.status(403).json({ error: 'Not authorized or game is not in waiting state' });

    req.app.get('io').to(`lobby:${req.params.code}`).emit('lobby:settingsUpdated', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/lobby/:code/messages — chat history ─────────────────────────────
router.get('/:code/messages', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query(
      "SELECT id FROM game_lobbies WHERE code = $1 AND status != 'discarded'",
      [req.params.code]
    );
    if (!lobbyRows[0]) return res.status(404).json({ error: 'Lobby not found' });

    const { rows } = await query(
      `SELECT lm.*,
              u.username AS sender_username, u.avatar_color AS sender_avatar,
              r.content AS reply_content, ru.username AS reply_sender_username
       FROM lobby_messages lm
       LEFT JOIN users u ON u.id = lm.sender_id
       LEFT JOIN lobby_messages r ON r.id = lm.reply_to_id
       LEFT JOIN users ru ON ru.id = r.sender_id
       WHERE lm.lobby_id = $1
       ORDER BY lm.created_at ASC LIMIT 200`,
      [lobbyRows[0].id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
