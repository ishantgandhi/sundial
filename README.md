# sundial

A small Node + TypeScript project that talks to Postgres.

## Setup

```bash
npm install
docker compose up -d
cp .env.example .env
```

## Run

```bash
npm run dev
```

Expected output: `connected, orders has 3 rows`

## Notes

- `db/init.sql` runs only on the first start of the Postgres volume. To re-run it, run `docker compose down -v` first.
- Port 5432 must be free on the host. If another Postgres (for example Homebrew) is already listening there, the app will connect to that one instead. Stop it, or change the left side of the `ports` mapping in `docker-compose.yml` and the port in `DATABASE_URL`.
- Postgres runs with `wal_level=logical` so change capture can be added later.
