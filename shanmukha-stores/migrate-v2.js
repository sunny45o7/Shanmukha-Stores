const pool = require('./config/db');

async function run() {
    try {
        console.log("Creating product_images table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_images (
                id SERIAL PRIMARY KEY,
                product_id INT REFERENCES products(id) ON DELETE CASCADE,
                image_url TEXT NOT NULL,
                is_primary BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Check if any primary images exist, if not, try to seed from products.image
        const check = await pool.query("SELECT COUNT(*) FROM product_images");
        if (parseInt(check.rows[0].count) === 0) {
            console.log("Seeding product_images from existing products table...");
            await pool.query(`
                INSERT INTO product_images (product_id, image_url, is_primary)
                SELECT id, image, true FROM products WHERE image IS NOT NULL AND image != '';
            `);
        }

        console.log("Successfully updated schema.");
        process.exit(0);
    } catch (err) {
        console.error("Migration v2 Error:", err);
        process.exit(1);
    }
}
run();
