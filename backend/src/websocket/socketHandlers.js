const { query } = require('../models/db');

const onlineUsers = new Map();

const setupSocketHandlers = (io) => {
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

    // ── Lobby chat ──────────────────────────────────────────────────────────
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

    // ── Audio ───────────────────────────────────────────────────────────────
    socket.on('lobby:audioStream',      ({ code, audioChunk }) => socket.to(`lobby:${code}`).emit('lobby:audioStream', { userId: user.id, username: user.username, audioChunk }));
    socket.on('lobby:audioStreamStart', ({ code })             => socket.to(`lobby:${code}`).emit('lobby:audioStreamStart', { userId: user.id, username: user.username }));
    socket.on('lobby:audioStreamEnd',   ({ code })             => socket.to(`lobby:${code}`).emit('lobby:audioStreamEnd', { userId: user.id }));

    // ── Typing ──────────────────────────────────────────────────────────────
    socket.on('chat:typing',  ({ receiverId, isTyping }) => io.to(`user:${receiverId}`).emit('chat:typing', { senderId: user.id, isTyping }));
    socket.on('lobby:typing', ({ code, isTyping })       => socket.to(`lobby:${code}`).emit('lobby:typing', { userId: user.id, username: user.username, isTyping }));

    // ── Hints ───────────────────────────────────────────────────────────────
    socket.on('game:submitHint', ({ code, hint }) => {
      if (!hint?.trim()) return;
      const word = hint.trim().split(/\s+/)[0].substring(0, 30);
      io.to(`lobby:${code}`).emit('game:hintSubmitted', { userId: user.id, username: user.username, hint: word });
    });

    // ── Turn management ─────────────────────────────────────────────────────
    socket.on('game:nextTurn', async ({ code, currentTurnUserId }) => {
      try {
        // Only the host advances turns
        const { rows: lobbyRows } = await query(
          `SELECT gl.turn_time, gl.current_round, gl.host_id, gl.voting_started,
                  gl.rounds_since_last_vote, gl.status
           FROM game_lobbies gl WHERE gl.code = $1`,
          [code]
        );
        const lobby = lobbyRows[0];
        if (!lobby || lobby.host_id !== user.id) return;

        // Never advance turns if game isn't actually playing
        if (lobby.status !== 'playing') return;

        // Never advance turns while voting is active
        if (lobby.voting_started) return;

        // Get current active (non-eliminated) players in join order
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

        const isFirstTurn = currentTurnUserId === '__start__';
        const currentIdx  = isFirstTurn ? -1 : playerRows.findIndex(p => p.id === currentTurnUserId);
        const nextIdx     = (currentIdx + 1) % playerRows.length;
        const nextPlayer  = playerRows[nextIdx];

        // A round completes when we wrap back to index 0 (not on first turn)
        const isNewRound = !isFirstTurn && nextIdx === 0;

        if (isNewRound) {
          const activeCount    = playerRows.length;
          const roundsSinceRaw = parseInt(lobby.rounds_since_last_vote || 0);

          // Negative sentinel means final-guess is pending — don't vote
          if (roundsSinceRaw < 0) return;

          // Don't vote if only 2 players left — that triggers final-guess via game route
          if (activeCount <= 2) {
            // Just proceed to next turn without voting
          } else {
            const { shouldStartVoting } = require('../utils/gameLogic');
            const roundsSince = roundsSinceRaw + 1;

            // Persist the incremented count first
            await query(
              'UPDATE game_lobbies SET rounds_since_last_vote = $1 WHERE code = $2',
              [roundsSince, code]
            );

            if (shouldStartVoting(activeCount, roundsSince)) {
              // Lock voting in DB immediately so duplicate nextTurn calls are blocked
              await query('UPDATE game_lobbies SET voting_started = TRUE WHERE code = $1', [code]);

              // 2.5s grace period — lets the last player finish their hint card
              setTimeout(() => {
                io.to(`lobby:${code}`).emit('game:votingStarted', {
                  round:   lobby.current_round,
                  message: `🗳️ Round ${roundsSince} complete — time to vote!`,
                  auto:    true,
                });
              }, 2500);
              return; // Don't emit turnChanged — voting takes over
            }
          }
        }

        // Emit next turn to all clients
        io.to(`lobby:${code}`).emit('game:turnChanged', {
          currentTurnUserId:   nextPlayer.id,
          currentTurnUsername: nextPlayer.username,
          turnTime:            lobby.turn_time,
          isNewRound,
          roundNumber:         lobby.current_round,
        });

      } catch (err) { console.error('game:nextTurn error:', err); }
    });

    // Relay turnDone — small delay so hint arrives before turn advances
    socket.on('game:turnDone', ({ code }) => {
      setTimeout(() => {
        io.to(`lobby:${code}`).emit('game:turnDone', { userId: user.id, username: user.username });
      }, 300);
    });

    // ── Disconnect → auto-pause ─────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] Disconnected: ${user.username} - ${reason}`);
      onlineUsers.delete(user.id);

      const { rows: activeGame } = await query(
        `SELECT gl.id, gl.code FROM lobby_members lm
         JOIN game_lobbies gl ON gl.id = lm.lobby_id
         WHERE lm.user_id = $1 AND gl.status = 'playing'`,
        [user.id]
      );

      if (activeGame[0]) {
        const { id, code } = activeGame[0];
        await query(
          `UPDATE game_lobbies SET status = 'paused', paused_by = $1, pause_reason = $2 WHERE id = $3`,
          [user.id, `${user.username} lost connection`, id]
        );
        await query(
          `UPDATE users SET status = 'online' WHERE id IN (SELECT user_id FROM lobby_members WHERE lobby_id = $1)`,
          [id]
        );
        io.to(`lobby:${code}`).emit('game:paused', {
          pausedBy: 'System',
          reason: `${user.username} lost connection — auto-paused`,
        });
      }

      await query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['offline', user.id]);
      io.emit('user:statusChange', { userId: user.id, status: 'offline' });
    });

    // ── Reconnect → auto-resume + re-sync turn state ────────────────────────
    socket.on('user:reconnect', async ({ code }) => {
      if (code) {
        socket.join(`lobby:${code}`);
        io.to(`lobby:${code}`).emit('game:playerReconnected', { userId: user.id, username: user.username });

        // Auto-resume only if THIS user caused the pause
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

          // Tell the host to restart turns after resume
          // Fetch the host so we can notify them specifically
          const { rows: hostRows } = await query(
            'SELECT host_id FROM game_lobbies WHERE code = $1', [code]
          );
          if (hostRows[0]) {
            io.to(`user:${hostRows[0].host_id}`).emit('game:resumeRestartTurns', { code });
          }
        }
      }

      await query('UPDATE users SET status = $1 WHERE id = $2', ['online', user.id]);
      io.emit('user:statusChange', { userId: user.id, status: 'online' });
    });
  });
};

module.exports = { setupSocketHandlers, onlineUsers };
