-- AI assistants that connect to /mcp over OAuth. Read-only: their tokens work on /mcp only, never on /api/.

-- Clients that registered through POST /oauth/register (Dynamic Client Registration). A client whose ID is an https
-- URL (a Client ID Metadata Document) has no row: the worker reads its document when it asks to connect.
-- redirect_uris is a JSON array of strings.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- An assistant asking to connect, from GET /oauth/authorize until its code is exchanged. The app's /connect/ page
-- shows it by id. A passkey approval sets user_id and code_hash, and expires_at moves to the code's expiry. The token
-- exchange sets grant_id, and the row stays until it expires, so a second exchange of the code finds the grant to
-- revoke. Times are ms since the epoch.
CREATE TABLE oauth_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  user_id TEXT,
  code_hash TEXT UNIQUE,
  grant_id TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX oauth_requests_expiry ON oauth_requests (expires_at);

-- One row per connected assistant: what Settings lists and Disconnect deletes. It holds the SHA-256 of the current
-- access and refresh tokens, hex. A refresh replaces both, so an old token stops working. Expiries are ms since the
-- epoch, the other times ISO strings.
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,
  access_expires_at INTEGER NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE INDEX oauth_grants_user ON oauth_grants (user_id);
CREATE INDEX oauth_grants_refresh_expiry ON oauth_grants (refresh_expires_at);
