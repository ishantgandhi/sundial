import pg from "pg";

// Read numeric columns as JS numbers (not strings), so live rows match the rebuilt rows and snapshots.
// Import this file ("./pg-setup.js") in anything that reads live rows and compares them.
pg.types.setTypeParser(1700, Number);
