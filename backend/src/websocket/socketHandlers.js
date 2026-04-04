const { query } = require('../models/db');
const http = require('http');

const onlineUsers = new Map();

// Internal helper: call our own REST API to trigger voting check after a round
const notifyRoundComplete = (code, hostToken) => {
  // We call the round-complete endpoint internally via the express app
  // This is set on the io object when we set up handlers
  return { code, hostToken };
};

const setupSocketHandlers = (io) => {
  // Store reference to express app for internal calls
  const app = io.httpServer?._events?.request?._router ? null : null;

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`[Socket] Connected: ${user.username} (${socket.id})`);

    onlineUsers.set(user.id, socket.id);
    socket.join(`user:${user.id}`);

    await query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['online', user.id]);
    io.emit('user:statusChange', { userId: user.id, status: 'online' });

    if (user.current_lobby_id) {
      const { rows } = await query('SELECT code FROM game_lobbies WHERE id = $1', [user.current_lobby_id]);
      if (rows[0]) {
        socket.join(`lobby:${rows[0].code}`);
        socket.emit('lobby:joined', { code: rows[0].code });
      }
    }

    socket.on('lobby:join', ({ code }) => socket.join(`lobby:${code}`));
    socket.on('lobby:leave', ({ code }) => socket.leave(`lobby:${code}`));

    // ── Lobby chat ────────────────────────────────────────────────────────
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
          ...rows[0], sender_username: user.username, sender_avatar: user.avatar_color,
        });
      } catch (err) { console.error('lobby:message error:', err); }
    });

    socket.on('lobby:reaction', async ({ code, messageId, emoji }) => {
      try {
        const { rows: lobbyRows } = await query('SELECT id FROM game_lobbies WHERE code = $1', [code]);
        if (!lobbyRows[0]) return;
        const { rows: msgRows } = await query('SELECT reactions FROM lobby_messages WHERE id = $1', [messageId]);
        if (!msgRows[0]) return;
        const reactions = msgRows[0].reactions || {};
        if (!reactions[emoji]) reactions[emoji] = [];
        const idx = reactions[emoji].indexOf(user.id);
        if (idx > -1) {
          reactions[emoji].splice(idx, 1);
          if (!reactions[emoji].length) delete reactions[emoji];
        } else {
          reactions[emoji].push(user.id);
        }
        await query('UPDATE lobby_messages SET reactions = $1 WHERE id = $2', [JSON.stringify(reactions), messageId]);
        io.to(`lobby:${code}`).emit('lobby:reaction', { messageId, reactions });
      } catch (err) { console.error('lobby:reaction error:', err); }
    });

    // ── Audio ─────────────────────────────────────────────────────────────
    socket.on('lobby:audioStream',      ({ code, audioChunk }) => socket.to(`lobby:${code}`).emit('lobby:audioStream', { userId: user.id, username: user.username, audioChunk }));
    socket.on('lobby:audioStreamStart', ({ code })             => socket.to(`lobby:${code}`).emit('lobby:audioStreamStart', { userId: user.id, username: user.username }));
    socket.on('lobby:audioStreamEnd',   ({ code })             => socket.to(`lobby:${code}`).emit('lobby:audioStreamEnd', { userId: user.id }));

    // ── Typing ────────────────────────────────────────────────────────────
    socket.on('chat:typing',  ({ receiverId, isTyping }) => io.to(`user:${receiverId}`).emit('chat:typing', { senderId: user.id, isTyping }));
    socket.on('lobby:typing', ({ code, isTyping })       => socket.to(`lobby:${code}`).emit('lobby:typing', { userId: user.id, username: user.username, isTyping }));

    // ── Hint (NOT saved to chat) ───────────────────────────────────────────
    socket.on('game:submitHint', ({ code, hint }) => {
      if (!hint?.trim()) return;
      const word = hint.trim().split(/\s+/)[0].substring(0, 30);
      io.to(`lobby:${code}`).emit('game:hintSubmitted', { userId: user.id, username: user.username, hint: word });
    });

    // ── Turn management ───────────────────────────────────────────────────
    socket.on('game:nextTurn', async ({ code, currentTurnUserId }) => {
      try {
        const { rows: lobbyRows } = await query(
          'SELECT turn_time, current_round, host_id, voting_started FROM game_lobbies WHERE code = $1',
          [code]
        );
        if (!lobbyRows[0] || lobbyRows[0].host_id !== user.id) return;
        if (lobbyRows[0].voting_started) return; // don't advance turns during voting

        const { rows: playerRows } = await query(
          `SELECT lm.user_id AS id, u.username
           FROM lobby_members lm
           JOIN users u ON u.id = lm.user_id
           WHERE lm.lobby_id = (SELECT id FROM game_lobbies WHERE code = $1)
             AND lm.is_eliminated = FALSE
           ORDER BY lm.joined_at ASC`,
          [code]
        );
        if (!playerRows.length) return;

        // '__start__' means the game just started — first player, no round completion
        const isFirstTurn = currentTurnUserId === '__start__';
        const currentIdx  = isFirstTurn ? -1 : playerRows.findIndex(p => p.id === currentTurnUserId);
        const nextIdx     = (currentIdx + 1) % playerRows.length;
        const nextPlayer  = playerRows[nextIdx];
        // A new round only completes when we wrap back to index 0 AND it's not the very first turn
        const isNewRound  = !isFirstTurn && nextIdx === 0;

        if (isNewRound) {
          // Fetch fresh lobby state (current_round managed by vote route, not here)
          const { rows: [lobbyFull] } = await query(
            `SELECT gl.*, COUNT(lm.user_id) FILTER (WHERE lm.is_eliminated = FALSE) AS active_count
             FROM game_lobbies gl
             LEFT JOIN lobby_members lm ON lm.lobby_id = gl.id
             WHERE gl.code = $1
             GROUP BY gl.id`,
            [code]
          );

          const activeCount = parseInt(lobbyFull.active_count);

          // Never start voting if 2 or fewer players remain — that's final-guess territory
          // Also never vote if rounds_since_last_vote is negative (finalGuess sentinel)
          const roundsSinceRaw = parseInt(lobbyFull.rounds_since_last_vote || 0);
          const finalGuessPending = roundsSinceRaw < 0;

          if (!lobbyFull.voting_started && !finalGuessPending && activeCount > 2) {
            const { shouldStartVoting } = require('../utils/gameLogic');
            const roundsSince = roundsSinceRaw + 1;

            await query(
              'UPDATE game_lobbies SET rounds_since_last_vote = $1 WHERE code = $2',
              [roundsSince, code]
            );

            if (shouldStartVoting(activeCount, roundsSince)) {
              await query('UPDATE game_lobbies SET voting_started = TRUE WHERE code = $1', [code]);
              io.to(`lobby:${code}`).emit('game:votingStarted', {
                round:   lobbyFull.current_round,
                message: `🗳️ Round ${lobbyFull.current_round} complete — time to vote!`,
                auto:    true,
              });
              // Voting takes over — don't emit turnChanged
              return;
            }
          } else if (finalGuessPending) {
            // Final guess still pending — don't advance turns
            return;
          }
        }

        // Re-fetch current_round (may have changed due to eliminations)
        const { rows: [freshLobby] } = await query(
          'SELECT current_round FROM game_lobbies WHERE code = $1', [code]
        );

        io.to(`lobby:${code}`).emit('game:turnChanged', {
          currentTurnUserId:   nextPlayer.id,
          currentTurnUsername: nextPlayer.username,
          turnTime:            lobbyRows[0].turn_time,
          isNewRound,
          roundNumber:         freshLobby ? freshLobby.current_round : lobbyRows[0].current_round,
        });

      } catch (err) { console.error('game:nextTurn error:', err); }
    });

    socket.on('game:turnDone', ({ code }) => {
      io.to(`lobby:${code}`).emit('game:turnDone', { userId: user.id, username: user.username });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] Disconnected: ${user.username} - ${reason}`);
      onlineUsers.delete(user.id);

      // Auto-pause any active game this player is in
      const { rows: activeGame } = await query(
        `SELECT gl.id, gl.code, gl.host_id FROM lobby_members lm
         JOIN game_lobbies gl ON gl.id = lm.lobby_id
         WHERE lm.user_id = $1 AND gl.status = 'playing'`,
        [user.id]
      );

      if (activeGame[0]) {
        const game = activeGame[0];
        // Auto-pause the game
        await query(
          `UPDATE game_lobbies SET status = 'paused', paused_by = $1, pause_reason = $2 WHERE id = $3`,
          [user.id, `${user.username} lost connection`, game.id]
        );
        await query(
          `UPDATE users SET status = 'online' WHERE id IN (SELECT user_id FROM lobby_members WHERE lobby_id = $1)`,
          [game.id]
        );
        io.to(`lobby:${game.code}`).emit('game:paused', {
          pausedBy: 'System',
          reason: `${user.username} lost internet connection — game auto-paused`,
        });
        io.to(`lobby:${game.code}`).emit('game:playerDisconnected', {
          userId: user.id, username: user.username,
          message: `${user.username} lost connection — game auto-paused. Will auto-resume when they return.`,
        });

        // Auto-resume after reconnect — track in memory
        // (handled in user:reconnect handler below)
      }

      await query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['offline', user.id]);
      io.emit('user:statusChange', { userId: user.id, status: 'offline' });
    });

    // ── Reconnect ─────────────────────────────────────────────────────────
    socket.on('user:reconnect', async ({ code }) => {
      if (code) {
        socket.join(`lobby:${code}`);
        io.to(`lobby:${code}`).emit('game:playerReconnected', { userId: user.id, username: user.username });

        // Auto-resume if the game was paused due to THIS user disconnecting
        const { rows: pausedGame } = await query(
          `SELECT gl.id, gl.code FROM game_lobbies gl
           JOIN lobby_members lm ON lm.lobby_id = gl.id AND lm.user_id = $1
           WHERE gl.code = $2 AND gl.status = 'paused' AND gl.paused_by = $1`,
          [user.id, code]
        );
        if (pausedGame[0]) {
          await query(
            `UPDATE game_lobbies SET status = 'playing', paused_by = NULL, pause_reason = NULL WHERE id = $1`,
            [pausedGame[0].id]
          );
          await query(
            `UPDATE users SET status = 'busy' WHERE id IN (
               SELECT user_id FROM lobby_members WHERE lobby_id = $1 AND is_eliminated = FALSE
             )`,
            [pausedGame[0].id]
          );
          io.to(`lobby:${code}`).emit('game:resumed', {
            resumedBy: `${user.username} (reconnected)`,
          });
        }
      }
      await query('UPDATE users SET status = $1 WHERE id = $2', ['online', user.id]);
      io.emit('user:statusChange', { userId: user.id, status: 'online' });
    });
  });
};

module.exports = { setupSocketHandlers, onlineUsers };
