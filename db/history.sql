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
