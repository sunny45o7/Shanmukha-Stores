const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

// Load .env from multiple potential locations for root vs subdir execution
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

const isRemoteDb =
  process.env.DB_SSL === "true" ||
  process.env.NODE_ENV === "production" ||
  /supabase\.com|render\.com|aws|railway/.test(process.env.DATABASE_URL || "");

const hasValidConfig = Boolean(
  process.env.DATABASE_URL || (process.env.DB_PASSWORD && process.env.DB_HOST)
);

let pool;

if (hasValidConfig) {
  const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: isRemoteDb ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 5000,
      }
    : {
        user: process.env.DB_USER || "postgres",
        host: process.env.DB_HOST || "localhost",
        database: process.env.DB_NAME || "shanmukha_stores",
        password: String(process.env.DB_PASSWORD || ""),
        port: Number(process.env.DB_PORT) || 5432,
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 5000,
      };

  pool = new Pool(poolConfig);

  pool.on("error", (err) => {
    console.error("PostgreSQL Pool idle client error:", err.message);
  });

  pool.query("SELECT 1")
    .then(() => console.log("✅ Connected to PostgreSQL"))
    .catch((err) => console.error("❌ PostgreSQL connection error:", err.message));
} else {
  console.warn("⚠️ No PostgreSQL credentials configured. Using safe stub pool.");
  pool = {
    query: async () => {
      throw new Error("DATABASE_URL is not configured in Environment Variables.");
    },
    connect: async () => {
      throw new Error("DATABASE_URL is not configured in Environment Variables.");
    },
    on: () => {},
  };
}

module.exports = pool;