-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    full_name  VARCHAR(100) NOT NULL,
    email      VARCHAR(100) UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    phone      VARCHAR(15),
    role       VARCHAR(20) DEFAULT 'customer',
    is_blocked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table (required by connect-pg-simple)
CREATE TABLE IF NOT EXISTS user_sessions (
    sid    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
    sess   JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);

-- =============================================
-- CATEGORIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    image       TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- PRODUCTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    description TEXT,
    price       NUMERIC(10,2) NOT NULL,
    stock       INT DEFAULT 0,
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    image       TEXT,
    offer_percent NUMERIC(5,2) DEFAULT 0,
    offer_active BOOLEAN DEFAULT false,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- CART TABLES (two-table design used by cartRoutes.js)
-- =============================================
CREATE TABLE IF NOT EXISTS carts (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
    id         SERIAL PRIMARY KEY,
    cart_id    INT REFERENCES carts(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE CASCADE,
    quantity   INT DEFAULT 1,
    UNIQUE(cart_id, product_id)
);

-- =============================================
-- ORDERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
    id             SERIAL PRIMARY KEY,
    user_id        INT REFERENCES users(id),
    total_amount   NUMERIC(10,2),
    status         VARCHAR(50) DEFAULT 'Pending',
    address        TEXT,
    city           VARCHAR(100),
    payment_method VARCHAR(50) DEFAULT 'cod',
    notes          TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- ORDER ITEMS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS order_items (
    id         SERIAL PRIMARY KEY,
    order_id   INT REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id),
    quantity   INT NOT NULL,
    price      NUMERIC(10,2) NOT NULL
);

-- =============================================
-- WISHLIST TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS wishlist (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
);

-- =============================================
-- BANNERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS banners (
    id         SERIAL PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    subtitle   TEXT,
    image      TEXT NOT NULL,
    link       TEXT,
    position   INT DEFAULT 0,
    is_active  BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- EXTENSIONS USED BY CURRENT APPLICATION CODE
-- =============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

CREATE TABLE IF NOT EXISTS addresses (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    full_name    VARCHAR(100) NOT NULL,
    phone        VARCHAR(20),
    address_line TEXT NOT NULL,
    city         VARCHAR(100) NOT NULL,
    state        VARCHAR(100) NOT NULL,
    pincode      VARCHAR(20) NOT NULL,
    is_default   BOOLEAN DEFAULT false,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS price_type VARCHAR(10) DEFAULT 'unit';
ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_percent NUMERIC(5,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_active BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS available_weights JSONB;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20);
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_cart_id_product_id_key;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_cart_id_product_id_weight_key UNIQUE(cart_id, product_id, selected_weight);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_id INT REFERENCES addresses(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_snapshot TEXT;

CREATE TABLE IF NOT EXISTS product_images (
    id         SERIAL PRIMARY KEY,
    product_id INT REFERENCES products(id) ON DELETE CASCADE,
    image_url  TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_settings (
    setting_key   VARCHAR(50) PRIMARY KEY,
    setting_value TEXT
);

CREATE TABLE IF NOT EXISTS returns (
    id         SERIAL PRIMARY KEY,
    order_id   INT REFERENCES orders(id),
    user_id    INT REFERENCES users(id),
    reason     TEXT,
    status     VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupons (
    id               SERIAL PRIMARY KEY,
    code             VARCHAR(50) UNIQUE NOT NULL,
    description      TEXT,
    discount_type    VARCHAR(20) NOT NULL DEFAULT 'percent',
    discount_value   NUMERIC(10,2) NOT NULL,
    min_order_amount NUMERIC(10,2) DEFAULT 0,
    starts_at        TIMESTAMP,
    ends_at          TIMESTAMP,
    usage_limit      INT,
    used_count       INT DEFAULT 0,
    is_active        BOOLEAN DEFAULT true,
    created_by       INT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_activities (
    id        SERIAL PRIMARY KEY,
    user_id   INT REFERENCES users(id) ON DELETE SET NULL,
    action    VARCHAR(100) NOT NULL,
    details   JSONB,
    target_id VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_logs (
    id        SERIAL PRIMARY KEY,
    recipient VARCHAR(255) NOT NULL,
    subject   VARCHAR(255) NOT NULL,
    staff_id  INT REFERENCES users(id) ON DELETE SET NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE CASCADE,
    rating     INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    is_approved BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
);

-- =============================================
-- POPUP ADS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS popup_ads (
    id         SERIAL PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    image_url  TEXT NOT NULL,
    target_url TEXT,
    is_active  BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- COLLECTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS collections (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    image       TEXT,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- COLLECTION PRODUCTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS collection_products (
    collection_id INT REFERENCES collections(id) ON DELETE CASCADE,
    product_id    INT REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, product_id)
);

INSERT INTO store_settings (setting_key, setting_value) VALUES
('store_name', 'Shanmukha Stores'),
('store_tagline', 'Authenticity in Every Piece'),
('marquee_text', 'Welcome to Shanmukha Stores!'),
('marquee_active', 'false'),
('marquee_speed', '30')
ON CONFLICT (setting_key) DO NOTHING;
