const { query } = require('../models/db');

const cleanupExpiredAccounts = async () => {
  try {
    const { rowCount } = await query(
      "DELETE FROM users WHERE is_temporary = TRUE AND expires_at < NOW() AND email_verified = FALSE"
    );
    if (rowCount > 0) {
      console.log(`[Cleanup] Deleted ${rowCount} expired temporary accounts`);
    }
    // Also clean expired refresh tokens
    await query("DELETE FROM refresh_tokens WHERE expires_at < NOW()");
  } catch (err) {
    console.error('[Cleanup] Error:', err);
  }
};

module.exports = { cleanupExpiredAccounts };
