
const pool = require("./config/db");

async function migrate() {
    try {
        console.log("Starting migration...");

        // Add price_type to products
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS price_type VARCHAR(10) DEFAULT 'unit'");
        console.log("Added price_type to products");

        // Add selected_weight to cart_items and order_items
        await pool.query("ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20)");
        await pool.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20)");
        console.log("Added selected_weight to cart_items and order_items");

        // Update uniqueness constraint for cart_items
        try {
            await pool.query("ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_cart_id_product_id_key");
            await pool.query("ALTER TABLE cart_items ADD CONSTRAINT cart_items_cart_id_product_id_weight_key UNIQUE(cart_id, product_id, selected_weight)");
            console.log("Updated cart_items uniqueness constraint");
        } catch (e) {
            console.log("Constraint might already exist or table is empty.");
        }

        console.log("Migration completed successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
