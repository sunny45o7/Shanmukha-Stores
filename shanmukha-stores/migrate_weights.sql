
-- Add price_type to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_type VARCHAR(10) DEFAULT 'unit';

-- Add selected_weight to cart_items and order_items
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20);

-- Update uniqueness constraint for cart_items to allow different weights of the same product
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_cart_id_product_id_key;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_cart_id_product_id_weight_key UNIQUE(cart_id, product_id, selected_weight);
