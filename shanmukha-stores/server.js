const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const app = express();

// Instant health check before any heavy middleware or session
app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    status: "ok",
    app: "Shanmukha Stores",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    isServerless: Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME),
    dbConnected: Boolean(app.locals.dbReady),
  });
});

app.use(compression());

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false, // Disabling default to set manually
    contentTypeOptions: false, // Disabling default to set manually
  })
);

// Manual Security Headers for granular control
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const cookieParser = require("cookie-parser");
const path = require("path");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");


const pool = require("./config/db");
const attachUser = require("./middleware/authMiddleware");

// ROUTES
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const adminRoutes = require("./routes/adminRoutes");
const staffRoutes = require("./routes/staffRoutes");
const profileRoutes = require("./routes/profileRoutes");
const addressRoutes = require("./routes/addressRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const reviewRoutes = require("./routes/reviewRoutes");

const ensureDatabaseSchema = async () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone VARCHAR(20),
      role VARCHAR(20) DEFAULT 'user',
      is_blocked BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      image TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      price NUMERIC(10,2) NOT NULL,
      stock INT DEFAULT 0,
      category_id INT REFERENCES categories(id) ON DELETE SET NULL,
      image TEXT,
      is_enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS carts (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS cart_items (
      id SERIAL PRIMARY KEY,
      cart_id INT REFERENCES carts(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id) ON DELETE CASCADE,
      quantity INT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id),
      total_amount NUMERIC(10,2),
      status VARCHAR(50) DEFAULT 'Pending',
      address TEXT,
      city VARCHAR(100),
      payment_method VARCHAR(50) DEFAULT 'cod',
      notes TEXT,
      transaction_id VARCHAR(255),
      payment_status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id),
      quantity INT NOT NULL,
      price NUMERIC(10,2) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wishlist (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    )`,
    `CREATE TABLE IF NOT EXISTS banners (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      subtitle TEXT,
      image TEXT NOT NULL,
      link TEXT,
      position INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT`,
    `ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user'`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS price_type VARCHAR(10) DEFAULT 'unit'`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_percent NUMERIC(5,2) DEFAULT 0`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS offer_active BOOLEAN DEFAULT false`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS available_weights JSONB`,
    `ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20)`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_weight VARCHAR(20)`,
    `CREATE TABLE IF NOT EXISTS addresses (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      full_name VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      address_line TEXT NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      pincode VARCHAR(20) NOT NULL,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_id INT REFERENCES addresses(id) ON DELETE SET NULL`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_snapshot TEXT`,
    `CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INT REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS store_settings (
      setting_key VARCHAR(50) PRIMARY KEY,
      setting_value TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS returns (
      id SERIAL PRIMARY KEY,
      order_id INT REFERENCES orders(id),
      user_id INT REFERENCES users(id),
      reason TEXT,
      status VARCHAR(50) DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      description TEXT,
      discount_type VARCHAR(20) NOT NULL DEFAULT 'percent',
      discount_value NUMERIC(10,2) NOT NULL,
      min_order_amount NUMERIC(10,2) DEFAULT 0,
      max_discount NUMERIC(10,2) DEFAULT 0,
      applicable_product_ids INT[],
      applicable_category_ids INT[],
      starts_at TIMESTAMP,
      ends_at TIMESTAMP,
      usage_limit INT,
      per_user_limit INT DEFAULT 1,
      used_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS coupon_usages (
      id SERIAL PRIMARY KEY,
      coupon_id INT REFERENCES coupons(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      order_id INT REFERENCES orders(id) ON DELETE SET NULL,
      discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS staff_activities (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      details JSONB,
      target_id VARCHAR(50),
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(160) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(30) DEFAULT 'info',
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS email_logs (
      id SERIAL PRIMARY KEY,
      recipient VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      staff_id INT REFERENCES users(id) ON DELETE SET NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS collaborations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      logo_url TEXT NOT NULL,
      website TEXT,
      sort_order INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id) ON DELETE CASCADE,
      rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
      review_text TEXT,
      is_approved BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    )`,
    `CREATE TABLE IF NOT EXISTS popup_ads (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      image_url TEXT NOT NULL,
      target_url TEXT,
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS collections (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      image TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS collection_products (
      collection_id INT REFERENCES collections(id) ON DELETE CASCADE,
      product_id INT REFERENCES products(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, product_id)
    )`,
    `INSERT INTO store_settings (setting_key, setting_value)
     VALUES
      ('store_name', 'Shanmukha Stores'),
      ('store_tagline', 'Authenticity in Every Piece'),
      ('marquee_text', 'Welcome to Shanmukha Stores!'),
      ('marquee_active', 'false'),
      ('marquee_speed', '30'),
      ('qr_code_image', '')
     ON CONFLICT (setting_key) DO NOTHING`,
  ];

  for (const sql of statements) {
    await pool.query(sql);
  }

  await pool.query("ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_discount NUMERIC(10,2) DEFAULT 0");
  await pool.query("ALTER TABLE coupons ADD COLUMN IF NOT EXISTS per_user_limit INT DEFAULT 1");
  await pool.query("ALTER TABLE coupons ADD COLUMN IF NOT EXISTS applicable_product_ids INT[]");
  await pool.query("ALTER TABLE coupons ADD COLUMN IF NOT EXISTS applicable_category_ids INT[]");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT true");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(10,2) DEFAULT 0");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id INT REFERENCES coupons(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50)");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(10,2) DEFAULT 0");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMP");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_note VARCHAR(255)");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP");
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT");
  await pool.query("ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS website TEXT");
  await pool.query("ALTER TABLE collaborations ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0");

  await pool.query("ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_cart_id_product_id_key");
  try {
    await pool.query(
      "ALTER TABLE cart_items ADD CONSTRAINT cart_items_cart_id_product_id_weight_key UNIQUE(cart_id, product_id, selected_weight)"
    );
  } catch (err) {
    if (!String(err.message).includes("already exists")) {
      console.warn("cart_items unique constraint warning:", err.message);
    }
  }
};

app.locals.pool = pool;
app.set("trust proxy", 1);

// ============================================================
// GLOBAL RATE LIMITER
// ============================================================
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || (process.env.NODE_ENV === "production" ? 10000 : 100000);

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
  skip: (req) =>
    req.path.startsWith("/css/") ||
    req.path.startsWith("/images/") ||
    req.path.startsWith("/uploads/") ||
    req.path.startsWith("/api/webhooks"),
});
app.use(globalLimiter);

// ============================================================
// STATIC ASSETS WITH AGGRESSIVE CACHING (Mounted early to bypass DB/session)
// ============================================================
const publicDirs = [
  path.join(__dirname, "public"),
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "shanmukha-stores", "public"),
].filter((d) => {
  try { return require("fs").existsSync(d); } catch (e) { return false; }
});

const staticCacheOptions = {
  maxAge: "30d",
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(webp|png|jpg|jpeg|svg|gif|ico|css|js|woff|woff2|ttf|mp4|webm)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    }
  },
};

publicDirs.forEach((dir) => {
  const uploadsPath = path.join(dir, "uploads");
  if (require("fs").existsSync(uploadsPath)) {
    app.use("/uploads", express.static(uploadsPath, staticCacheOptions));
  }
  app.use(express.static(dir, staticCacheOptions));
});

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl && req.originalUrl.startsWith("/api/webhooks")) {
        req.rawBody = buf.toString();
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: "user_sessions",
      errorLog: (err) => console.error("Session Store Error:", err.message),
    }),
    secret: process.env.SESSION_SECRET || "shanmukha_super_secret_key_2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

app.use(attachUser);

// ============================================================
// GLOBAL SETTINGS (IN-MEMORY CACHE TO AVOID SERIAL DB CALLS)
// ============================================================
let cachedSettingsData = null;
let lastSettingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60 * 1000; // 60 seconds TTL

app.locals.invalidateSettingsCache = () => {
  cachedSettingsData = null;
  lastSettingsCacheTime = 0;
};

app.use(async (req, res, next) => {
  try {
    const now = Date.now();
    if (!cachedSettingsData || now - lastSettingsCacheTime > SETTINGS_CACHE_TTL) {
      const [result, adResult, collectionsResult] = await Promise.all([
        pool.query("SELECT * FROM store_settings"),
        pool.query("SELECT * FROM popup_ads WHERE is_active = true ORDER BY id DESC LIMIT 1"),
        pool.query("SELECT id, name FROM collections WHERE is_active = true ORDER BY id DESC"),
      ]);

      const settings = {};
      result.rows.forEach((r) => {
        settings[r.setting_key] = r.setting_value;
      });

      const normalize = (value, fallback) => {
        if (value === null || value === undefined) return fallback;
        const str = String(value).trim();
        return str.length > 0 ? str : fallback;
      };

      const finalSettings = {
        store_name: normalize(settings.store_name, "Shanmukha Stores"),
        store_tagline: normalize(settings.store_tagline, "Authenticity in Every Piece"),
        ...settings,
      };

      finalSettings.store_name = normalize(finalSettings.store_name, "Shanmukha Stores");
      finalSettings.store_tagline = normalize(finalSettings.store_tagline, "Authenticity in Every Piece");

      cachedSettingsData = {
        settings: finalSettings,
        popupAd: adResult.rows[0] || null,
        collectionsList: collectionsResult.rows || [],
      };
      lastSettingsCacheTime = now;
    }

    res.locals.settings = cachedSettingsData.settings;
    res.locals.popupAd = cachedSettingsData.popupAd;
    res.locals.collectionsList = cachedSettingsData.collectionsList;
    next();
  } catch (err) {
    console.error("Settings Middleware Error:", err);
    res.locals.settings = { store_name: "Shanmukha Stores", store_tagline: "Authenticity in Every Piece" };
    res.locals.popupAd = null;
    res.locals.collectionsList = [];
    next();
  }
});

// ============================================================
// VIEW ENGINE
// ============================================================
app.set("view engine", "ejs");
const viewsDirs = [
  path.join(__dirname, "views"),
  path.join(process.cwd(), "views"),
  path.join(process.cwd(), "shanmukha-stores", "views"),
].filter((d) => {
  try { return require("fs").existsSync(d); } catch (e) { return false; }
});
app.set("views", viewsDirs.length > 0 ? viewsDirs : path.join(__dirname, "views"));


// ============================================================
// ROUTES
// ============================================================
app.use("/", productRoutes);
app.use("/auth", authRoutes);
app.use("/cart", cartRoutes);
app.use("/orders", orderRoutes);
app.use("/wishlist", wishlistRoutes);
app.use("/admin", adminRoutes);
app.use("/staff", staffRoutes);
app.use("/profile", profileRoutes);
app.use("/addresses", addressRoutes);
app.use("/notifications", notificationRoutes);
app.use("/products/:productId/reviews", reviewRoutes);

// ============================================================
// 404 ERROR PAGE
// ============================================================
app.use((req, res) => {
  res.status(404).render("errors/404", {
    title: "Page Not Found",
    user: res.locals.user || null,
  });
});

// ============================================================
// 500 ERROR PAGE
// ============================================================
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack || err.message || err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500);
  try {
    res.render("errors/500", {
      title: "Server Error",
      user: res.locals.user || null,
      error: process.env.NODE_ENV === "development" ? err.message : "Something went wrong.",
    });
  } catch (renderErr) {
    res.type("html").send(
      `<!DOCTYPE html><html><head><title>500 - Server Error</title></head><body style="font-family:sans-serif;padding:40px;text-align:center;"><h1>Server Error</h1><p>${process.env.NODE_ENV === "development" ? err.message : "Something went wrong."}</p><a href="/">Return Home</a></body></html>`
    );
  }
});

// ============================================================
// SERVER START
// ============================================================
const PORT = process.env.PORT || 3000;
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const startServer = () => {
  if (isServerless) {
    app.locals.dbReady = true;
    return;
  }

  // Open HTTP port immediately so hosting platforms (e.g. Render, Railway) detect port binding without delay
  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Verify database schema asynchronously in background
  (async () => {
    let dbReady = false;
    let retries = 5;
    const retryDelayMs = 3000;

    while (retries > 0) {
      try {
        await ensureDatabaseSchema();
        dbReady = true;
        console.log("✅ Database schema verified successfully.");
        break;
      } catch (err) {
        retries -= 1;
        console.error(`❌ Startup schema check failed. Retries remaining: ${retries}. Error:`, err.message || err);
        if (retries === 0) {
          console.warn("⚠️ PostgreSQL schema check failed. App running in degraded mode.");
          break;
        }
        console.log(`Waiting ${retryDelayMs / 1000}s before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    app.locals.dbReady = dbReady;

    if (dbReady && process.env.ENABLE_WHATSAPP_BOT !== "false") {
      try {
        const { initWhatsAppBot } = require("./services/whatsappBot");
        initWhatsAppBot();
      } catch (waErr) {
        console.error("WhatsApp bot start error:", waErr);
      }
    }
  })();
};


// ============================================================
// GLOBAL PROCESS ERROR HANDLERS
// ============================================================
process.on("uncaughtException", (err) => {
  console.error("CRITICAL: Uncaught Exception:", err.stack || err);
  if (!isServerless) {
    process.exit(1);
  }
});

process.on("unhandledRejection", (err) => {
  console.error("CRITICAL: Unhandled Promise Rejection:", err.stack || err);
});

startServer();

module.exports = app;
