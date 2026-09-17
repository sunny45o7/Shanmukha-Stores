const { Pool } = require("pg");
require("dotenv").config();

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === "true" || process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
    }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch(err => console.error("❌ PostgreSQL connection error:", err));

module.exports = pool;