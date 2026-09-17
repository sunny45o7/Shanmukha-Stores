const pool = require('./config/db');

async function run() {
    try {
        console.log("Creating staff_activities and email_logs tables...");

        await pool.query(`
            CREATE TABLE IF NOT EXISTS staff_activities (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE SET NULL,
                action VARCHAR(100) NOT NULL,
                details JSONB,
                target_id VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS email_logs (
                id SERIAL PRIMARY KEY,
                recipient VARCHAR(255) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                staff_id INT REFERENCES users(id) ON DELETE SET NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add last_active to users table if not exists
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);

        console.log("Governance tables created successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Migration Error:", err);
        process.exit(1);
    }
}
run();
