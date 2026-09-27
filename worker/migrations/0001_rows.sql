CREATE TABLE exercises (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX exercises_user_rev ON exercises (user_id, rev);

CREATE TABLE programs (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX programs_user_rev ON programs (user_id, rev);

CREATE TABLE sessions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  date TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX sessions_user_rev ON sessions (user_id, rev);
CREATE INDEX sessions_user_date ON sessions (user_id, date);

CREATE TABLE sets (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX sets_user_rev ON sets (user_id, rev);
CREATE INDEX sets_user_session ON sets (user_id, session_id);
CREATE INDEX sets_user_exercise ON sets (user_id, exercise_id);
