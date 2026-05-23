const pool = require('./config/db');

async function run() {
    try {
        console.log("Adding is_verified to users...");
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;`);
        console.log("Success! Exiting.");
        process.exit(0);
    } catch (err) {
        console.error("Migration Error:", err);
        process.exit(1);
    }
}
run();
