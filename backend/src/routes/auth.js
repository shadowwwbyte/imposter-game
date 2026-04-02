const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { query } = require('../models/db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const { authenticate } = require('../middleware/auth');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
};

const AVATAR_COLORS = ['#458588','#cc241d','#98971a','#d79921','#689d6a','#b16286','#427b58','#d65d0e'];

// POST /api/auth/register
router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
  body('password').isLength({ min: 6 }),
  body('email').optional().isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, password, email } = req.body;
  const isTemporary = !email;

  try {
    // Check username uniqueness
    const existing = await query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (existing.rows[0]) return res.status(409).json({ error: 'Username already taken' });

    if (email) {
      const emailExists = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (emailExists.rows[0]) return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = email ? uuidv4() : null;
    const expiresAt = isTemporary ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, is_temporary, email_verified, verification_token, verification_token_expires, avatar_color, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, username, email, is_temporary, email_verified, avatar_color`,
      [
        username.toLowerCase(), email || null, passwordHash, isTemporary,
        false, verificationToken,
        verificationToken ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
        avatarColor, expiresAt
      ]
    );

    const user = rows[0];

    if (email && verificationToken) {
      await sendVerificationEmail(email, username, verificationToken).catch(console.error);
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
    );

    res.status(201).json({
      user: { ...user, username: user.username },
      accessToken,
      refreshToken,
      message: email ? 'Account created! Please verify your email.' : 'Temporary account created (expires in 30 days).',
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('identifier').trim().notEmpty(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { identifier, password } = req.body;

  try {
    const { rows } = await query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [identifier.toLowerCase()]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    // Update status to online
    await query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['online', user.id]);

    const { accessToken, refreshToken } = generateTokens(user.id);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
    );

    res.json({
      user: {
        id: user.id, username: user.username, email: user.email,
        is_temporary: user.is_temporary, email_verified: user.email_verified,
        avatar_color: user.avatar_color, status: 'online',
        total_games: user.total_games, games_won: user.games_won,
      },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { rows } = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()',
      [refreshToken, decoded.userId]
    );

    if (!rows[0]) return res.status(401).json({ error: 'Invalid refresh token' });

    // Rotate refresh token
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    const tokens = generateTokens(decoded.userId);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [decoded.userId, tokens.refreshToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
    );

    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body;
  try {
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    await query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['offline', req.user.id]);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', [body('email').isEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email } = req.body;
  try {
    const { rows } = await query('SELECT id, username FROM users WHERE email = $1', [email.toLowerCase()]);
    // Always respond with success to prevent email enumeration
    if (!rows[0]) return res.json({ message: 'If that email exists, a reset link was sent.' });

    const token = uuidv4();
    await query(
      'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [token, new Date(Date.now() + 60 * 60 * 1000), rows[0].id]
    );

    await sendPasswordResetEmail(email, rows[0].username, token).catch(console.error);
    res.json({ message: 'If that email exists, a reset link was sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { token, password } = req.body;
  try {
    const { rows } = await query(
      'SELECT id FROM users WHERE password_reset_token = $1 AND password_reset_expires > NOW()',
      [token]
    );

    if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired token' });

    const passwordHash = await bcrypt.hash(password, 12);
    await query(
      'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
      [passwordHash, rows[0].id]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id FROM users WHERE verification_token = $1 AND verification_token_expires > NOW()',
      [req.params.token]
    );

    if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired verification link' });

    await query(
      'UPDATE users SET email_verified = TRUE, is_temporary = FALSE, verification_token = NULL, expires_at = NULL WHERE id = $1',
      [rows[0].id]
    );

    res.json({ message: 'Email verified! Your account is now permanent.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/add-email (for temp accounts)
router.post('/add-email', authenticate, [body('email').isEmail()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email } = req.body;
  try {
    const emailExists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (emailExists.rows[0]) return res.status(409).json({ error: 'Email already in use' });

    const token = uuidv4();
    await query(
      'UPDATE users SET email = $1, verification_token = $2, verification_token_expires = $3 WHERE id = $4',
      [email.toLowerCase(), token, new Date(Date.now() + 24 * 60 * 60 * 1000), req.user.id]
    );

    await sendVerificationEmail(email, req.user.username, token).catch(console.error);
    res.json({ message: 'Verification email sent! Verify to make your account permanent.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
