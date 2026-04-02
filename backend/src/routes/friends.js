const express = require('express');
const router = express.Router();
const { query } = require('../models/db');
const { authenticate } = require('../middleware/auth');

// GET /api/friends - list friends with status
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.avatar_color, u.status, u.current_lobby_id,
              f.status AS friendship_status, f.id AS friendship_id,
              CASE WHEN f.requester_id = $1 THEN 'sent' ELSE 'received' END AS direction
       FROM friendships f
       JOIN users u ON (
         CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END = u.id
       )
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status IN ('accepted', 'pending')
       ORDER BY u.username`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friends/request
router.post('/request', authenticate, async (req, res) => {
  const { username } = req.body;
  try {
    const { rows: targetRows } = await query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (!targetRows[0]) return res.status(404).json({ error: 'User not found' });
    const targetId = targetRows[0].id;

    if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

    const existing = await query(
      'SELECT * FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)',
      [req.user.id, targetId]
    );

    if (existing.rows[0]) {
      if (existing.rows[0].status === 'accepted') return res.status(409).json({ error: 'Already friends' });
      if (existing.rows[0].status === 'pending') return res.status(409).json({ error: 'Request already pending' });
    }

    const { rows } = await query(
      'INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) RETURNING id',
      [req.user.id, targetId]
    );

    // Notify via socket
    const io = req.app.get('io');
    io.to(`user:${targetId}`).emit('friend:request', {
      friendshipId: rows[0].id,
      from: { id: req.user.id, username: req.user.username, avatar_color: req.user.avatar_color },
    });

    res.status(201).json({ message: 'Friend request sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friends/accept/:friendshipId
router.post('/accept/:friendshipId', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE friendships SET status = $1, updated_at = NOW() WHERE id = $2 AND addressee_id = $3 AND status = $4 RETURNING *',
      ['accepted', req.params.friendshipId, req.user.id, 'pending']
    );

    if (!rows[0]) return res.status(404).json({ error: 'Request not found' });

    const io = req.app.get('io');
    io.to(`user:${rows[0].requester_id}`).emit('friend:accepted', {
      friendshipId: rows[0].id,
      by: { id: req.user.id, username: req.user.username, avatar_color: req.user.avatar_color },
    });

    res.json({ message: 'Friend request accepted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/friends/:friendshipId
router.delete('/:friendshipId', authenticate, async (req, res) => {
  try {
    await query(
      'DELETE FROM friendships WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)',
      [req.params.friendshipId, req.user.id]
    );
    res.json({ message: 'Removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
