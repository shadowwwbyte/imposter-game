/**
 * Assign roles to players.
 * Imposters = 20-25% of total, minimum 1.
 */
const assignRoles = (playerIds) => {
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const total = shuffled.length;
  const imposterCount = Math.max(1, Math.round(total * 0.22)); // ~22%

  return {
    imposters: shuffled.slice(0, imposterCount),
    innocents: shuffled.slice(imposterCount),
  };
};

/**
 * Calculate vote result.
 * Returns the eliminated player or indicates a tie.
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
      tiedPlayers: topVoted.map(v => ({ userId: v.voted_for_id, username: v.username, votes: parseInt(v.vote_count) })),
    };
  }

  return {
    isTie: false,
    eliminated: voteTally[0],
  };
};

/**
 * Check if game has ended based on remaining players.
 * 
 * End conditions:
 * - All imposters eliminated → innocents win
 * - Only 1 imposter + 1 innocent remain → imposter gets to guess
 * - Only imposters remain → imposters win
 */
const checkGameEnd = (remainingPlayers) => {
  const innocents = remainingPlayers.filter(p => p.role === 'innocent');
  const imposters = remainingPlayers.filter(p => p.role === 'imposter');

  if (imposters.length === 0) {
    return { ended: true, winner: 'innocents', reason: 'All imposters have been eliminated!' };
  }

  if (innocents.length === 0) {
    return { ended: true, winner: 'imposters', reason: 'All innocents have been eliminated!' };
  }

  // If imposters >= innocents, imposters win (they can't be voted out)
  if (imposters.length >= innocents.length) {
    return {
      ended: true,
      winner: 'imposters',
      reason: 'Imposters now equal or outnumber innocents!',
      finalGuessRequired: true,
      remainingImposters: imposters,
    };
  }

  return { ended: false };
};

/**
 * Determine if voting should start.
 * < 5 players: vote after 2 rounds
 * 5+ players: vote after each round
 */
const shouldStartVoting = (playerCount, currentRound) => {
  if (playerCount >= 5) return currentRound >= 1;
  return currentRound >= 2;
};

module.exports = { assignRoles, calculateVoteResult, checkGameEnd, shouldStartVoting };
