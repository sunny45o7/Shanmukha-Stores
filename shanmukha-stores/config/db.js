const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

// Load .env from multiple potential locations
[
  path.join(__dirname, "../.env"),
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "shanmukha-stores/.env"),
].forEach((envPath) => {
  try {
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
    }
  } catch (e) {}
});
require("dotenv").config();

// Primary hardcoded fallback to Supabase credentials
const SUPABASE_DB_URL = "postgresql://postgres.pvewycmtsioplsefcbwo:26047SIHvvit@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true";
const connectionString = process.env.DATABASE_URL || SUPABASE_DB_URL;

const poolConfig = {
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
};

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("PostgreSQL Pool idle client error:", err.message);
});

pool.query("SELECT 1")
  .then(() => console.log("✅ Connected to Supabase PostgreSQL"))
  .catch((err) => console.error("❌ PostgreSQL connection error:", err.message));

module.exports = pool;