/**
 * Assign roles.
 * Imposters = ~22% of total, minimum 1.
 */
const assignRoles = (playerIds) => {
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const total = shuffled.length;
  const imposterCount = Math.max(1, Math.round(total * 0.22));
  return {
    imposters: shuffled.slice(0, imposterCount),
    innocents: shuffled.slice(imposterCount),
  };
};

/**
 * Tally votes and return result.
 * Returns eliminated player or a tie.
 */
const calculateVoteResult = (voteTally) => {
  if (!voteTally || voteTally.length === 0) {
    return { isTie: true, tiedPlayers: [] };
  }
  const maxVotes = parseInt(voteTally[0].vote_count);
  const topVoted = voteTally.filter(v => parseInt(v.vote_count) === maxVotes);

  if (topVoted.length > 1) {
    return {
      isTie: true,
      tiedPlayers: topVoted.map(v => ({
        userId: v.voted_for_id,
        username: v.username,
        votes: parseInt(v.vote_count),
      })),
    };
  }
  return { isTie: false, eliminated: voteTally[0] };
};

/**
 * Check end conditions after each elimination.
 *
 * Outcomes:
 *  - No imposters left           → innocents win immediately
 *  - No innocents left           → imposters win immediately
 *  - Exactly 1 imposter + 1 innocent remain → imposter gets a final word guess
 *  - Imposters outnumber innocents (2+ imposters, fewer innocents) → imposters win
 *  - Otherwise                   → game continues
 */
const checkGameEnd = (remainingPlayers) => {
  const innocents = remainingPlayers.filter(p => p.role === 'innocent');
  const imposters = remainingPlayers.filter(p => p.role === 'imposter');

  if (imposters.length === 0) {
    return { ended: true, winner: 'innocents', reason: 'All imposters eliminated!' };
  }

  if (innocents.length === 0) {
    return { ended: true, winner: 'imposters', reason: 'All innocents eliminated!' };
  }

  // 1 imposter vs 1 innocent → imposter gets to guess the word
  if (imposters.length === 1 && innocents.length === 1) {
    return {
      ended: false,
      finalGuess: true,
      reason: 'Last imposter standing — must guess the innocent word!',
      imposter: imposters[0],
    };
  }

  // Multiple imposters remain and they outnumber (or equal) innocents → imposters win
  // (they could never all be voted out before taking over)
  if (imposters.length >= innocents.length) {
    return {
      ended: true,
      winner: 'imposters',
      reason: 'Imposters outnumber the innocents!',
    };
  }

  return { ended: false };
};

/**
 * Should voting start automatically after this round completes?
 *
 * Rules:
 *  - 5+ active players  → vote after every round  (roundsPerVote = 1)
 *  - 3 or 4 players     → vote after every 2 rounds
 */
const shouldStartVoting = (activePlayerCount, roundsCompletedSinceLastVote) => {
  if (activePlayerCount >= 5) return roundsCompletedSinceLastVote >= 1;
  return roundsCompletedSinceLastVote >= 2;
};

module.exports = { assignRoles, calculateVoteResult, checkGameEnd, shouldStartVoting };
