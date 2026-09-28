import { initDatabase, pool } from "../lib/db";

try {
  await initDatabase();
  console.log("Sentinel database initialized.");
} finally {
  await pool.end();
}
