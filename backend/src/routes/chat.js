const express = require('express');
const router = express.Router();
const { query } = require('../models/db');
const { authenticate } = require('../middleware/auth');

// GET /api/chat/conversations - list all DM conversations
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (other_user_id)
         other_user_id,
         u.username, u.avatar_color, u.status,
         dm.content, dm.message_type, dm.created_at,
         dm.sender_id,
         (SELECT COUNT(*) FROM direct_messages 
          WHERE receiver_id = $1 AND sender_id = other_user_id AND read_at IS NULL) AS unread_count
       FROM (
         SELECT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_user_id,
                id, content, message_type, created_at, sender_id
         FROM direct_messages
         WHERE sender_id = $1 OR receiver_id = $1
       ) dm
       JOIN users u ON u.id = dm.other_user_id
       ORDER BY other_user_id, dm.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/chat/messages/:userId - get messages with a user
router.get('/messages/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const { before, limit = 50 } = req.query;

  try {
    let q = `
      SELECT dm.*, 
             s.username AS sender_username, s.avatar_color AS sender_avatar,
             r.content AS reply_content, r.sender_id AS reply_sender_id,
             ru.username AS reply_sender_username
      FROM direct_messages dm
      JOIN users s ON s.id = dm.sender_id
      LEFT JOIN direct_messages r ON r.id = dm.reply_to_id
      LEFT JOIN users ru ON ru.id = r.sender_id
      WHERE (dm.sender_id = $1 AND dm.receiver_id = $2)
         OR (dm.sender_id = $2 AND dm.receiver_id = $1)
    `;
    const params = [req.user.id, userId];

    if (before) {
      q += ` AND dm.created_at < $${params.length + 1}`;
      params.push(before);
    }

    q += ` ORDER BY dm.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows } = await query(q, params);

    // Mark as read
    await query(
      'UPDATE direct_messages SET read_at = NOW() WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL',
      [req.user.id, userId]
    );

    res.json(rows.reverse());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/chat/messages - send a DM
router.post('/messages', authenticate, async (req, res) => {
  const { receiverId, content, messageType = 'text', audioUrl, replyToId } = req.body;

  try {
    const { rows } = await query(
      `INSERT INTO direct_messages (sender_id, receiver_id, content, message_type, audio_url, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, receiverId, content, messageType, audioUrl, replyToId || null]
    );

    const message = rows[0];

    // Emit via socket
    const io = req.app.get('io');
    const msgWithSender = { ...message, sender_username: req.user.username, sender_avatar: req.user.avatar_color };
    io.to(`user:${receiverId}`).emit('chat:message', msgWithSender);
    io.to(`user:${req.user.id}`).emit('chat:message', msgWithSender);

    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/chat/messages/:messageId/react
router.post('/messages/:messageId/react', authenticate, async (req, res) => {
  const { emoji } = req.body;
  try {
    const { rows } = await query(
      `UPDATE direct_messages
       SET reactions = jsonb_set(
         reactions,
         $1::text[],
         (COALESCE(reactions #> $1::text[], '[]'::jsonb) || $2::jsonb)
       )
       WHERE id = $3 RETURNING *`,
      [[emoji], JSON.stringify([req.user.id]), req.params.messageId]
    );

    const io = req.app.get('io');
    if (rows[0]) {
      io.to(`user:${rows[0].sender_id}`).emit('chat:reaction', { messageId: rows[0].id, reactions: rows[0].reactions });
      io.to(`user:${rows[0].receiver_id}`).emit('chat:reaction', { messageId: rows[0].id, reactions: rows[0].reactions });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/chat/search - search users to start a chat
router.get('/search', authenticate, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  try {
    const { rows } = await query(
      `SELECT id, username, avatar_color, status FROM users
       WHERE username ILIKE $1 AND id != $2 LIMIT 10`,
      [`${q}%`, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
