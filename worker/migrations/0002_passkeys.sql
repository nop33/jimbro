-- Accounts made by signing up with a passkey. Users from AUTH_TOKENS have no row here.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- One row per passkey. id is the credential ID, base64url. public_key is the SPKI the browser reported at
-- registration, base64url, and alg its COSE algorithm: -7 (ES256) or -257 (RS256).
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX passkeys_user ON passkeys (user_id);

-- Bearer tokens handed out by a passkey sign-up or sign-in. Only the SHA-256 of a token is stored, hex.
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX auth_tokens_user ON auth_tokens (user_id);

-- WebAuthn challenges, each good for one verify before expires_at (ms since the epoch). purpose is register, signin
-- or add. user_id is the account a register creates or an add extends, and null for a sign-in.
CREATE TABLE auth_challenges (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  user_id TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX auth_challenges_expiry ON auth_challenges (expires_at);
