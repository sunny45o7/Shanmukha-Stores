const { Pool } = require('pg');
require('dotenv').config();

const isRemoteDb =
  process.env.DB_SSL === "true" ||
  process.env.NODE_ENV === "production" ||
  /supabase\.com|render\.com|aws|railway/.test(process.env.DATABASE_URL || "");

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isRemoteDb ? { rejectUnauthorized: false } : false,
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
    .then(() => console.log("PostgreSQL Connected Successfully ✅"))
    .catch(err => console.error("Database Connection Error ❌", err));

module.exports = pool;