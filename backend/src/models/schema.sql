-- Imposter Game Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(32) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_temporary BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(255),
  verification_token_expires TIMESTAMPTZ,
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMPTZ,
  avatar_color VARCHAR(7) DEFAULT '#458588',
  status VARCHAR(20) DEFAULT 'offline', -- offline, online, busy
  current_lobby_id UUID,
  total_games INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0,
  times_imposter INTEGER DEFAULT 0,
  imposter_wins INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ -- for temporary accounts (30 days)
);

-- Friendships
CREATE TABLE IF NOT EXISTS friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, blocked
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id)
);

-- Direct messages
CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  message_type VARCHAR(20) DEFAULT 'text', -- text, audio, system
  audio_url VARCHAR(500),
  reply_to_id UUID REFERENCES direct_messages(id),
  reactions JSONB DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Game lobbies
CREATE TABLE IF NOT EXISTS game_lobbies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(8) UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100),
  status VARCHAR(20) DEFAULT 'waiting', -- waiting, playing, paused, finished
  max_players INTEGER DEFAULT 10,
  turn_time INTEGER DEFAULT 30, -- seconds
  word_category VARCHAR(100) DEFAULT 'general',
  current_round INTEGER DEFAULT 0,
  innocent_word VARCHAR(255),
  imposter_word VARCHAR(255),
  voting_started BOOLEAN DEFAULT FALSE,
  paused_by UUID REFERENCES users(id),
  pause_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- Lobby members (current active members)
CREATE TABLE IF NOT EXISTS lobby_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20), -- innocent, imposter
  assigned_word VARCHAR(255),
  is_eliminated BOOLEAN DEFAULT FALSE,
  elimination_round INTEGER,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lobby_id, user_id)
);

-- Game chat messages (lobby chat)
CREATE TABLE IF NOT EXISTS lobby_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT,
  message_type VARCHAR(20) DEFAULT 'text', -- text, audio, system
  audio_url VARCHAR(500),
  reply_to_id UUID REFERENCES lobby_messages(id),
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Votes per round
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  voter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voted_for_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lobby_id, round_number, voter_id)
);

-- Game results / history
CREATE TABLE IF NOT EXISTS game_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id UUID NOT NULL REFERENCES game_lobbies(id) ON DELETE CASCADE,
  winner_team VARCHAR(20), -- innocents, imposters
  innocent_word VARCHAR(255),
  imposter_word VARCHAR(255),
  total_rounds INTEGER,
  player_results JSONB, -- [{userId, username, role, wasEliminated, ...}]
  finished_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(sender_id, receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lobby_members_user ON lobby_members(user_id);
CREATE INDEX IF NOT EXISTS idx_lobby_messages_lobby ON lobby_messages(lobby_id, created_at);
CREATE INDEX IF NOT EXISTS idx_votes_lobby_round ON votes(lobby_id, round_number);
CREATE INDEX IF NOT EXISTS idx_game_lobbies_code ON game_lobbies(code);

-- Auto-expire temporary accounts (run via cron or pg_cron)
-- DELETE FROM users WHERE is_temporary = TRUE AND expires_at < NOW();
