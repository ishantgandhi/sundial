CREATE TABLE changes (
  id           bigserial PRIMARY KEY,
  lsn          pg_lsn NOT NULL,
  xid          bigint NOT NULL,
  committed_at timestamptz NOT NULL,
  table_name   text NOT NULL,
  action       text NOT NULL CHECK (action IN ('insert','update','delete')),
  row_key      jsonb NOT NULL,
  old_row      jsonb,
  new_row      jsonb
);

CREATE INDEX ON changes (committed_at);

-- One row per snapshot: every row of a table, frozen at one log position (lsn).
CREATE TABLE snapshots (
  id         bigserial PRIMARY KEY,
  lsn        pg_lsn NOT NULL,
  taken_at   timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  rows       jsonb NOT NULL
);

-- Speed up replay (WHERE table_name AND lsn > ... ORDER BY lsn, id) and "latest snapshot before a time".
CREATE INDEX IF NOT EXISTS changes_table_lsn_id ON changes (table_name, lsn, id);
CREATE INDEX IF NOT EXISTS snapshots_table_taken ON snapshots (table_name, taken_at);
EOF