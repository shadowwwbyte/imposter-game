const express = require('express');
const router = express.Router();
const { query } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { generateGameWords } = require('../services/geminiService');
const { assignRoles, calculateVoteResult, checkGameEnd, shouldStartVoting } = require('../utils/gameLogic');

// ─── Start game ────────────────────────────────────────────────────────────
router.post('/:code/start', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query(
      `SELECT gl.*, json_agg(lm.user_id) AS member_ids
       FROM game_lobbies gl
       JOIN lobby_members lm ON lm.lobby_id = gl.id
       WHERE gl.code = $1 GROUP BY gl.id`,
      [req.params.code]
    );

    const lobby = lobbyRows[0];
    if (!lobby)                        return res.status(404).json({ error: 'Lobby not found' });
    if (lobby.host_id !== req.user.id) return res.status(403).json({ error: 'Only host can start' });
    if (lobby.status !== 'waiting')    return res.status(400).json({ error: 'Game not in waiting state' });

    const memberIds = lobby.member_ids;
    if (memberIds.length < 3) return res.status(400).json({ error: 'Need at least 3 players' });

    const { innocentWord, imposterWord } = await generateGameWords(lobby.word_category);
    const { innocents, imposters } = assignRoles(memberIds);
    const imposterCount = imposters.length;

    // current_round = 1, rounds_since_last_vote = 0
    await query(
      `UPDATE game_lobbies
       SET status = 'playing', innocent_word = $1, imposter_word = $2,
           current_round = 1, rounds_since_last_vote = 0, started_at = NOW()
       WHERE id = $3`,
      [innocentWord, imposterWord, lobby.id]
    );

    for (const userId of innocents) {
      await query(
        'UPDATE lobby_members SET role = $1, assigned_word = $2 WHERE lobby_id = $3 AND user_id = $4',
        ['innocent', innocentWord, lobby.id, userId]
      );
    }
    for (const userId of imposters) {
      await query(
        'UPDATE lobby_members SET role = $1, assigned_word = $2 WHERE lobby_id = $3 AND user_id = $4',
        ['imposter', imposterWord, lobby.id, userId]
      );
    }

    await query(`UPDATE users SET status = 'busy' WHERE id = ANY($1::uuid[])`, [memberIds]);

    const io = req.app.get('io');
    for (const userId of innocents) {
      io.to(`user:${userId}`).emit('game:started', {
        role: 'innocent', word: innocentWord, imposterCount,
        totalPlayers: memberIds.length,
      });
    }
    for (const userId of imposters) {
      io.to(`user:${userId}`).emit('game:started', {
        role: 'imposter', word: imposterWord, imposterCount,
        totalPlayers: memberIds.length,
      });
    }

    const votingRule = memberIds.length >= 5
      ? 'Voting will start automatically after each round.'
      : 'Voting will start automatically after every 2 rounds.';

    io.to(`lobby:${req.params.code}`).emit('game:announcement', {
      message: `🎮 Game started! ${imposterCount} imposter${imposterCount > 1 ? 's' : ''} among ${memberIds.length} players. ${votingRule}`,
    });

    res.json({ message: 'Game started', imposterCount });
  } catch (err) {
    console.error('Start game error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Round completed (called by socketHandlers when last player in a round finishes) ─
// This is triggered via socket, but we expose it as REST too so the host client can call it.
router.post('/:code/round-complete', authenticate, async (req, res) => {
  try {
    const { rows: lobbyRows } = await query(
      `SELECT gl.*,
              COUNT(lm.user_id) FILTER (WHERE lm.is_eliminated = FALSE) AS active_count
       FROM game_lobbies gl
       LEFT JOIN lobby_members lm ON lm.lobby_id = gl.id
       WHERE gl.code = $1
       GROUP BY gl.id`,
      [req.params.code]
    );

    const lobby = lobbyRows[0];
    if (!lobby || lobby.status !== 'playing') return res.status(400).json({ error: 'Game not active' });
    if (lobby.voting_started) return res.json({ message: 'Already voting' });

    const activeCount = parseInt(lobby.active_count);
    const roundsSince = parseInt(lobby.rounds_since_last_vote || 0) + 1;

    // Increment rounds_since_last_vote
    await query(
      'UPDATE game_lobbies SET rounds_since_last_vote = $1 WHERE id = $2',
      [roundsSince, lobby.id]
    );

    if (shouldStartVoting(activeCount, roundsSince)) {
      await triggerVoting(lobby, roundsSince, req.app.get('io'), req.params.code, query);
    }

    res.json({ message: 'Round noted', votingTriggered: shouldStartVoting(activeCount, roundsSince) });
  } catch (err) {
    console.error('round-complete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Cast vote ─────────────────────────────────────────────────────────────
router.post('/:code/vote', authenticate, async (req, res) => {
  const { votedForId } = req.body;
  try {
    const { rows: lobbyRows } = await query(
      'SELECT * FROM game_lobbies WHERE code = $1 AND status = $2',
      [req.params.code, 'playing']
    );

    const lobby = lobbyRows[0];
    if (!lobby)               return res.status(404).json({ error: 'Lobby not found or game not active' });
    if (!lobby.voting_started) return res.status(400).json({ error: 'Voting has not started' });

    // Voter must be active
    const { rows: memberRows } = await query(
      'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2 AND is_eliminated = FALSE',
      [lobby.id, req.user.id]
    );
    if (!memberRows[0]) return res.status(403).json({ error: 'You are not an active player' });

    // Voted-for must also be active (can't vote for eliminated player)
    const { rows: targetRows } = await query(
      'SELECT * FROM lobby_members WHERE lobby_id = $1 AND user_id = $2 AND is_eliminated = FALSE',
      [lobby.id, votedForId]
    );
    if (!targetRows[0]) return res.status(400).json({ error: 'Cannot vote for an eliminated player' });

    // Upsert vote for this voting sub-round
    await query(
      `INSERT INTO votes (lobby_id, round_number, voter_id, voted_for_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lobby_id, round_number, voter_id) DO UPDATE SET voted_for_id = $4`,
      [lobby.id, lobby.current_round, req.user.id, votedForId]
    );

    // How many active players vs votes cast this sub-round
    const { rows: [{ count: activeCount }] } = await query(
      'SELECT COUNT(*) FROM lobby_members WHERE lobby_id = $1 AND is_eliminated = FALSE',
      [lobby.id]
    );
    const { rows: [{ count: voteCount }] } = await query(
      'SELECT COUNT(*) FROM votes WHERE lobby_id = $1 AND round_number = $2',
      [lobby.id, lobby.current_round]
    );

    const io = req.app.get('io');
    io.to(`lobby:${req.params.code}`).emit('game:voteReceived', {
      voterId: req.user.id,
      votedForId,
      totalVotes: parseInt(voteCount),
      totalPlayers: parseInt(activeCount),
    });

    // All votes in?
    if (parseInt(voteCount) >= parseInt(activeCount)) {
      const { rows: voteTally } = await query(
        `SELECT voted_for_id, COUNT(*) AS vote_count, u.username
         FROM votes v
         JOIN users u ON u.id = v.voted_for_id
         WHERE v.lobby_id = $1 AND v.round_number = $2
         GROUP BY voted_for_id, u.username
         ORDER BY vote_count DESC`,
        [lobby.id, lobby.current_round]
      );

      const result = calculateVoteResult(voteTally);

      if (result.isTie) {
        // Tiebreak: increment round so votes reset, keep voting_started = TRUE
        await query(
          'UPDATE game_lobbies SET current_round = current_round + 1 WHERE id = $1',
          [lobby.id]
        );
        io.to(`lobby:${req.params.code}`).emit('game:voteTie', {
          message: "It's a tie! Vote again among the tied players.",
          tiedPlayers: result.tiedPlayers,
        });
      } else {
        // Eliminate the player with most votes
        const eliminatedId = result.eliminated.voted_for_id;
        const { rows: [eliminated] } = await query(
          `UPDATE lobby_members
           SET is_eliminated = TRUE, elimination_round = $1
           WHERE lobby_id = $2 AND user_id = $3
           RETURNING role, assigned_word`,
          [lobby.current_round, lobby.id, eliminatedId]
        );

        io.to(`lobby:${req.params.code}`).emit('game:playerEliminated', {
          userId:   eliminatedId,
          username: result.eliminated.username,
          role:     eliminated.role,
          word:     eliminated.assigned_word,
          votes:    voteTally,
        });

        // Reset: next game round, voting closed, reset rounds_since_last_vote
        await query(
          `UPDATE game_lobbies
           SET current_round = current_round + 1,
               voting_started = FALSE,
               rounds_since_last_vote = 0
           WHERE id = $1`,
          [lobby.id]
        );

        // Check remaining players
        const { rows: remaining } = await query(
          `SELECT lm.role, lm.user_id, lm.assigned_word, u.username
           FROM lobby_members lm
           JOIN users u ON u.id = lm.user_id
           WHERE lm.lobby_id = $1 AND lm.is_eliminated = FALSE`,
          [lobby.id]
        );

        const endCheck = checkGameEnd(remaining);

        if (endCheck.ended) {
          await handleGameEnd(lobby, endCheck, io, req.params.code, query);
        } else if (endCheck.finalGuess) {
          // 1 imposter vs 1 innocent — imposter must guess
          io.to(`lobby:${req.params.code}`).emit('game:finalGuessRequired', {
            imposterId:   endCheck.imposter.user_id,
            imposterName: endCheck.imposter.username,
            message:      `⚔️ ${endCheck.imposter.username} is the last imposter! They must now guess the innocent word.`,
          });
          // Privately tell the imposter
          io.to(`user:${endCheck.imposter.user_id}`).emit('game:youMustGuess', {
            message: 'You are the last imposter! Guess the innocent word to win.',
          });
        }
        // else game continues normally — frontend will restart turns
      }
    }

    res.json({ message: 'Vote cast' });
  } catch (err) {
    console.error('Vote error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Pause ─────────────────────────────────────────────────────────────────
router.post('/:code/pause', authenticate, async (req, res) => {
  const { reason } = req.body;
  try {
    const { rows: memberCheck } = await query(
      `SELECT lm.id FROM lobby_members lm
       JOIN game_lobbies gl ON gl.id = lm.lobby_id
       WHERE gl.code = $1 AND lm.user_id = $2 AND gl.status = 'playing'`,
      [req.params.code, req.user.id]
    );
    if (!memberCheck[0]) return res.status(403).json({ error: 'Not an active player in this game' });

    const { rows } = await query(
      `UPDATE game_lobbies SET status = 'paused', paused_by = $1, pause_reason = $2
       WHERE code = $3 AND status = 'playing' RETURNING *`,
      [req.user.id, reason || null, req.params.code]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Game is not in playing state' });

    await query(
      `UPDATE users SET status = 'online' WHERE id IN (SELECT user_id FROM lobby_members WHERE lobby_id = $1)`,
      [rows[0].id]
    );

    req.app.get('io').to(`lobby:${req.params.code}`).emit('game:paused', { pausedBy: req.user.username, reason });
    res.json({ message: 'Game paused' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Resume ────────────────────────────────────────────────────────────────
router.post('/:code/resume', authenticate, async (req, res) => {
  try {
    const { rows: memberCheck } = await query(
      `SELECT lm.id FROM lobby_members lm
       JOIN game_lobbies gl ON gl.id = lm.lobby_id
       WHERE gl.code = $1 AND lm.user_id = $2 AND gl.status = 'paused'`,
      [req.params.code, req.user.id]
    );
    if (!memberCheck[0]) return res.status(403).json({ error: 'Not a player in this paused game' });

    const { rows } = await query(
      `UPDATE game_lobbies SET status = 'playing', paused_by = NULL, pause_reason = NULL
       WHERE code = $1 AND status = 'paused' RETURNING *`,
      [req.params.code]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Game is not paused' });

    await query(
      `UPDATE users SET status = 'busy'
       WHERE id IN (SELECT user_id FROM lobby_members WHERE lobby_id = $1 AND is_eliminated = FALSE)`,
      [rows[0].id]
    );

    req.app.get('io').to(`lobby:${req.params.code}`).emit('game:resumed', { resumedBy: req.user.username });
    res.json({ message: 'Game resumed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Imposter final word guess ─────────────────────────────────────────────
router.post('/:code/guess-word', authenticate, async (req, res) => {
  const { guessedWord } = req.body;
  try {
    const { rows: lobbyRows } = await query(
      `SELECT gl.*, lm.role
       FROM game_lobbies gl
       JOIN lobby_members lm ON lm.lobby_id = gl.id
       WHERE gl.code = $1 AND lm.user_id = $2 AND lm.is_eliminated = FALSE`,
      [req.params.code, req.user.id]
    );

    const lobby = lobbyRows[0];
    if (!lobby || lobby.role !== 'imposter') return res.status(403).json({ error: 'Not an active imposter' });

    const isCorrect = guessedWord.toLowerCase().trim() === lobby.innocent_word.toLowerCase().trim();
    const io = req.app.get('io');

    if (isCorrect) {
      await handleGameEnd(lobby, { ended: true, winner: 'imposters', reason: 'Imposter correctly guessed the innocent word!' }, io, req.params.code, query);
    } else {
      io.to(`lobby:${req.params.code}`).emit('game:wrongGuess', {
        userId: req.user.id, guessedWord,
        message: `${req.user.username} guessed "${guessedWord}" — WRONG! Imposter eliminated.`,
      });

      await query(
        'UPDATE lobby_members SET is_eliminated = TRUE WHERE lobby_id = $1 AND user_id = $2',
        [lobby.id, req.user.id]
      );

      const { rows: remaining } = await query(
        `SELECT lm.role, lm.user_id, lm.assigned_word, u.username
         FROM lobby_members lm JOIN users u ON u.id = lm.user_id
         WHERE lm.lobby_id = $1 AND lm.is_eliminated = FALSE`,
        [lobby.id]
      );

      // After wrong guess, if any imposters remain check end again
      const endCheck = checkGameEnd(remaining);
      if (endCheck.ended) {
        await handleGameEnd(lobby, endCheck, io, req.params.code, query);
      } else if (endCheck.finalGuess) {
        // Another imposter remains with 1 innocent — they must guess too
        io.to(`lobby:${req.params.code}`).emit('game:finalGuessRequired', {
          imposterId:   endCheck.imposter.user_id,
          imposterName: endCheck.imposter.username,
          message:      `⚔️ ${endCheck.imposter.username} must now guess the innocent word!`,
        });
        io.to(`user:${endCheck.imposter.user_id}`).emit('game:youMustGuess', {
          message: 'You are the last imposter! Guess the innocent word to win.',
        });
      } else {
        // Innocents win by elimination
        await handleGameEnd(lobby, { ended: true, winner: 'innocents', reason: 'All imposters eliminated!' }, io, req.params.code, query);
      }
    }

    res.json({ correct: isCorrect });
  } catch (err) {
    console.error('guess-word error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Internal helpers ──────────────────────────────────────────────────────

async function triggerVoting(lobby, roundsSince, io, code, queryFn) {
  await queryFn(
    'UPDATE game_lobbies SET voting_started = TRUE WHERE id = $1',
    [lobby.id]
  );

  const activeCount = parseInt(lobby.active_count || 0);
  const rule = activeCount >= 5
    ? 'All players vote — most votes gets eliminated.'
    : 'All players vote — most votes gets eliminated.';

  io.to(`lobby:${code}`).emit('game:votingStarted', {
    round: lobby.current_round,
    message: `🗳️ Round ${roundsSince} complete — time to vote! ${rule}`,
  });
}

async function handleGameEnd(lobby, endCheck, io, code, queryFn) {
  await queryFn(
    "UPDATE game_lobbies SET status = 'finished', finished_at = NOW() WHERE id = $1",
    [lobby.id]
  );

  await queryFn(
    `UPDATE users SET status = 'online', current_lobby_id = NULL
     WHERE id IN (SELECT user_id FROM lobby_members WHERE lobby_id = $1)`,
    [lobby.id]
  );

  const { rows: playerResults } = await queryFn(
    `SELECT lm.user_id, lm.role, lm.assigned_word, lm.is_eliminated, lm.elimination_round, u.username
     FROM lobby_members lm JOIN users u ON u.id = lm.user_id WHERE lm.lobby_id = $1`,
    [lobby.id]
  );

  for (const player of playerResults) {
    const won = (endCheck.winner === 'innocents' && player.role === 'innocent') ||
                (endCheck.winner === 'imposters' && player.role === 'imposter');
    await queryFn(
      `UPDATE users SET
         total_games    = total_games + 1,
         games_won      = games_won + $1,
         times_imposter = times_imposter + $2,
         imposter_wins  = imposter_wins + $3
       WHERE id = $4`,
      [won ? 1 : 0, player.role === 'imposter' ? 1 : 0,
       (player.role === 'imposter' && endCheck.winner === 'imposters') ? 1 : 0,
       player.user_id]
    );
  }

  await queryFn(
    `INSERT INTO game_results (lobby_id, winner_team, innocent_word, imposter_word, total_rounds, player_results)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [lobby.id, endCheck.winner, lobby.innocent_word, lobby.imposter_word,
     lobby.current_round, JSON.stringify(playerResults)]
  );

  io.to(`lobby:${code}`).emit('game:ended', {
    winner:       endCheck.winner,
    reason:       endCheck.reason,
    innocentWord: lobby.innocent_word,
    imposterWord: lobby.imposter_word,
    players:      playerResults,
  });
}

module.exports = router;
