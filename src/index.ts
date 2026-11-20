import pg from "pg";

// Node 20.12+ / 21.7+ can load .env directly, so no dotenv needed.
// ponytail: missing .env is a hard error here; fine for a learning project.
process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const result = await client.query<{ count: string }>("SELECT count(*) FROM orders");
const count = Number(result.rows[0].count);
console.log(`connected, orders has ${count} rows`);

await client.end();
