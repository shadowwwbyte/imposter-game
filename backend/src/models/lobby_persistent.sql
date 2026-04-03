-- Run on EC2:
-- psql $DATABASE_URL -f migration_lobby_persistent.sql

-- 1. Add 'discarded' as a valid status (Postgres CHECK constraint needs updating if present)
-- If you have a CHECK constraint, drop it first:
ALTER TABLE game_lobbies DROP CONSTRAINT IF EXISTS game_lobbies_status_check;

-- 2. Add rounds_since_last_vote if not already there
ALTER TABLE game_lobbies ADD COLUMN IF NOT EXISTS rounds_since_last_vote INTEGER DEFAULT 0;

-- 3. Reset any 'finished' lobbies to 'waiting' so existing data stays usable
UPDATE game_lobbies SET
  status                 = 'waiting',
  innocent_word          = NULL,
  imposter_word          = NULL,
  current_round          = 0,
  rounds_since_last_vote = 0,
  voting_started         = FALSE,
  paused_by              = NULL,
  pause_reason           = NULL,
  started_at             = NULL
WHERE status = 'finished';

-- 4. Reset lobby_members game state for those lobbies
UPDATE lobby_members SET
  role              = NULL,
  assigned_word     = NULL,
  is_eliminated     = FALSE,
  elimination_round = NULL
WHERE lobby_id IN (
  SELECT id FROM game_lobbies WHERE status = 'waiting'
);

-- 5. Update the generateLobbyCode helper exclusion (already handled in code)
-- Nothing more needed here

SELECT 'Migration complete' AS result;
