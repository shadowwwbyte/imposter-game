-- Run this on your EC2 postgres to add the missing column
ALTER TABLE game_lobbies
  ADD COLUMN IF NOT EXISTS rounds_since_last_vote INTEGER DEFAULT 0;
