const pool = require('./config/db');

async function run() {
    try {
        console.log("Creating store_settings and returns tables...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS store_settings (
                setting_key VARCHAR(50) PRIMARY KEY,
                setting_value TEXT
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS returns (
                id SERIAL PRIMARY KEY,
                order_id INT REFERENCES orders(id),
                user_id INT REFERENCES users(id),
                reason TEXT,
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("Inserting default settings if not exists...");
        await pool.query(`
            INSERT INTO store_settings (setting_key, setting_value) 
            VALUES 
                ('marquee_text', 'Welcome to Shanmukha Stores! Use code NEW10 for 10% off.'), 
                ('marquee_active', 'true')
            ON CONFLICT (setting_key) DO NOTHING;
        `);

        console.log("Success! Exiting.");
        process.exit(0);
    } catch (err) {
        console.error("Migration Error:", err);
        process.exit(1);
    }
}
run();
