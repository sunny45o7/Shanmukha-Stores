const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const fs = require('fs');
const path = require('path');


const multer = require('multer');
const {
    DEFAULT_WEIGHT_OPTIONS,
    parseCustomWeights,
    sanitizeWeightList,
    getProductWeightOptions,
} = require('../utils/weightUtils');
const { processImageToWebP, processMediaFile } = require('../utils/imageUtils');

const qrCodeUploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(qrCodeUploadDir)) {
    fs.mkdirSync(qrCodeUploadDir, { recursive: true });
}

const qrCodeImageStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, qrCodeUploadDir),
    filename: (_req, file, cb) => {
        let safeExt = '.jpg';
        if (file.mimetype === 'image/png') safeExt = '.png';
        else if (file.mimetype === 'image/jpeg') safeExt = '.jpg';
        else if (file.mimetype === 'image/webp') safeExt = '.webp';
        
        const name = `qr-code-${Date.now()}${safeExt}`;
        cb(null, name);
    }
});

const qrCodeImageUpload = multer({
    storage: qrCodeImageStorage,
    limits: { files: 1, fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: (_req, file, cb) => {
        if (String(file.mimetype || '').startsWith('image/')) return cb(null, true);
        cb(new Error('Only image files are allowed'));
    }
});
const productUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'products');

const productImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 25, fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (_req, file, cb) => {
        const mime = String(file.mimetype || '');
        if (mime.startsWith('image/') || mime.startsWith('video/')) return cb(null, true);
        cb(new Error('Only image and video files are allowed'));
    }
});

const addProductUploadMiddleware = (req, res, next) => {
    productImageUpload.array('product_images', 25)(req, res, (err) => {
        if (err) return res.redirect('/admin/products?error=' + encodeURIComponent(err.message));
        return next();
    });
};

const editProductUploadMiddleware = (req, res, next) => {
    productImageUpload.array('product_images', 25)(req, res, (err) => {
        if (err) return res.redirect('/admin/products/edit/' + req.params.id + '?error=' + encodeURIComponent(err.message));
        return next();
    });
};

/* ===============================
   ADMIN MIDDLEWARE & HELPERS
=============================== */
const logActivity = async (userId, action, details = {}) => {
    try {
        await pool.query(
            "INSERT INTO staff_activities (user_id, action, details) VALUES ($1, $2, $3)",
            [userId, action, JSON.stringify(details)]
        );
        await pool.query("UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1", [userId]);
    } catch (err) { console.error("Logging Error:", err); }
};

const parseAvailableWeightsFromBody = (body, priceType) => {
    if (priceType !== 'kg') return [];
    const selected = Array.isArray(body.weight_options)
        ? body.weight_options
        : (body.weight_options ? [body.weight_options] : []);
    const custom = parseCustomWeights(body.custom_weight_options);
    return sanitizeWeightList([...selected, ...custom], false);
};

const parsePositiveIntList = (input) => {
    const values = Array.isArray(input) ? input : (input ? [input] : []);
    return Array.from(
        new Set(
            values
                .map((v) => parseInt(v, 10))
                .filter((v) => Number.isInteger(v) && v > 0)
        )
    );
};

const getUploadedImageUrls = (files = []) =>
    files.map((file) => `/uploads/products/${file.filename}`);

const addProductImages = async (client, productId, imageUrls, preferredPrimaryImage) => {
    const uniqueUrls = Array.from(new Set((imageUrls || []).map((u) => String(u || '').trim()).filter(Boolean)));
    if (!uniqueUrls.length) return;

    const existing = await client.query(
        "SELECT id, image_url, is_primary FROM product_images WHERE product_id = $1 ORDER BY created_at ASC",
        [productId]
    );
    const existingByUrl = new Set(existing.rows.map((row) => row.image_url));
    let hasPrimary = existing.rows.some((row) => row.is_primary);

    const primaryImage = uniqueUrls.includes(preferredPrimaryImage) ? preferredPrimaryImage : uniqueUrls[0];

    for (const url of uniqueUrls) {
        if (existingByUrl.has(url)) continue;
        const isPrimary = !hasPrimary && url === primaryImage;
        await client.query(
            "INSERT INTO product_images (product_id, image_url, is_primary) VALUES ($1, $2, $3)",
            [productId, url, isPrimary]
        );
        if (isPrimary) hasPrimary = true;
    }

    if (!hasPrimary) {
        await client.query(
            `UPDATE product_images
             SET is_primary = true
             WHERE id = (
                SELECT id FROM product_images
                WHERE product_id = $1
                ORDER BY created_at ASC
                LIMIT 1
             )`,
            [productId]
        );
    }
};

const isAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login?error=Admin access required');
    }
    if (req.session.user.role !== 'admin') {
        return res.status(403).send('403 Forbidden: Admin access required');
    }
    next();
};

// ============================================================
// API: ADMIN SEARCH SUGGESTIONS
// ============================================================
router.get('/api/search/suggestions', isAdmin, async (req, res) => {
    try {
        const { q, type } = req.query;
        if (!q || q.trim().length < 1) return res.json([]);
        const query = `%${q.trim()}%`;
        let result = [];
        
        if (type === 'all' || !type) {
            const [p, u, o] = await Promise.all([
                pool.query("SELECT id, name, image FROM products WHERE name ILIKE $1 ORDER BY name ASC LIMIT 3", [query]),
                pool.query("SELECT id, full_name as name, email FROM users WHERE full_name ILIKE $1 OR email ILIKE $1 ORDER BY full_name ASC LIMIT 3", [query]),
                pool.query("SELECT o.id, o.total_amount, o.status as payment_status, u.full_name as name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id::text ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1 LIMIT 3", [query])
            ]);
            result = [
                ...p.rows.map(item => ({ id: item.id, label: item.name, sub: 'Product', image: item.image, url: `/admin/products?search=${encodeURIComponent(item.name)}` })),
                ...u.rows.map(item => ({ id: item.id, label: item.name, sub: `User • ${item.email}`, url: `/admin/users?search=${encodeURIComponent(item.name)}` })),
                ...o.rows.map(item => ({ id: item.id, label: `Order #${item.id} - ${item.name}`, sub: `Order • ₹${item.total_amount} (${item.payment_status})`, url: `/admin/orders?search=${encodeURIComponent(item.id)}` }))
            ];
        } else if (type === 'products') {
            const r = await pool.query("SELECT id, name, image FROM products WHERE name ILIKE $1 ORDER BY name ASC LIMIT 6", [query]);
            result = r.rows.map(item => ({ id: item.id, label: item.name, sub: '', image: item.image, url: `/admin/products?search=${encodeURIComponent(item.name)}` }));
        } else if (type === 'users') {
            const r = await pool.query("SELECT id, full_name as name, email FROM users WHERE full_name ILIKE $1 OR email ILIKE $1 ORDER BY full_name ASC LIMIT 6", [query]);
            result = r.rows.map(item => ({ id: item.id, label: item.name, sub: item.email, url: `/admin/users?search=${encodeURIComponent(item.name)}` }));
        } else if (type === 'orders') {
            const r = await pool.query("SELECT o.id, o.total_amount, o.status as payment_status, u.full_name as name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id::text ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1 LIMIT 6", [query]);
            result = r.rows.map(item => ({ id: item.id, label: `Order #${item.id} - ${item.name}`, sub: `₹${item.total_amount} (${item.payment_status})`, url: `/admin/orders?search=${encodeURIComponent(item.id)}` }));
        }
        res.json(result);
    } catch (err) {
        console.error("Admin Search API Error:", err.message);
        res.status(500).json([]);
    }
});

const isStaff = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login?error=Administrative privileges required');
    }
    if (req.session.user.role === 'staff') {
        return res.redirect('/staff/dashboard?error=Use Staff Panel for staff operations');
    }
    if (req.session.user.role !== 'admin') {
        return res.status(403).send('403 Forbidden: Administrative privileges required');
    }
    next();
};

/* ===============================
   DASHBOARD
=============================== */
router.get('/', isStaff, (req, res) => res.redirect('/admin/dashboard'));

router.get('/dashboard', isStaff, async (req, res) => {
    try {
        const [
            users, products, orders, revenue, pending, categories,
            revenueByDayResult, revenueByCategoryResult, salesByCityResult, avgOrderValueResult
        ] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM users"),
            pool.query("SELECT COUNT(*) FROM products"),
            pool.query("SELECT COUNT(*) FROM orders"),
            pool.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM orders WHERE status != 'Cancelled'"),
            pool.query("SELECT COUNT(*) FROM orders WHERE status='Pending'"),
            pool.query("SELECT COUNT(*) FROM categories"),
            pool.query(`
                SELECT TO_CHAR(created_at, 'DD.MM') AS day, COALESCE(SUM(total_amount), 0) AS revenue 
                FROM orders 
                WHERE status != 'Cancelled' AND created_at >= NOW() - INTERVAL '7 days' 
                GROUP BY TO_CHAR(created_at, 'DD.MM'), DATE(created_at) 
                ORDER BY DATE(created_at) ASC
            `),
            pool.query(`
                SELECT COALESCE(c.name, 'Uncategorized') AS category, COUNT(oi.id) as count 
                FROM order_items oi 
                JOIN products p ON p.id = oi.product_id 
                LEFT JOIN categories c ON c.id = p.category_id 
                JOIN orders o ON o.id = oi.order_id 
                WHERE o.status != 'Cancelled' AND o.created_at >= NOW() - INTERVAL '30 days' 
                GROUP BY c.name 
                ORDER BY count DESC
            `),
            pool.query(`
                SELECT city, COUNT(*) as count 
                FROM orders 
                WHERE status != 'Cancelled' AND city IS NOT NULL AND city != '' 
                GROUP BY city 
                ORDER BY count DESC 
                LIMIT 5
            `),
            pool.query(`
                SELECT COALESCE(AVG(total_amount), 0) AS avg_value 
                FROM orders 
                WHERE status != 'Cancelled'
            `)
        ]);

        const recentOrders = await pool.query(
            `SELECT orders.*, users.full_name AS user_name FROM orders
             JOIN users ON users.id = orders.user_id
             ORDER BY orders.created_at DESC LIMIT 8`
        );
        const recentUsers = await pool.query(
            "SELECT id, full_name AS name, email, created_at, role FROM users ORDER BY created_at DESC LIMIT 6"
        );

        const activities = await pool.query(
            "SELECT a.*, u.full_name as user_name FROM staff_activities a JOIN users u ON a.user_id = u.id ORDER BY a.timestamp DESC LIMIT 5"
        );

        res.render('admin/dashboard', {
            title: 'Dashboard', user: req.session.user,
            stats: {
                users: users.rows[0].count,
                products: products.rows[0].count,
                orders: orders.rows[0].count,
                revenue: Number(revenue.rows[0].total).toLocaleString('en-IN'),
                pending: pending.rows[0].count,
                categories: categories.rows[0].count,
                avgOrderValue: Math.round(Number(avgOrderValueResult.rows[0].avg_value))
            },
            chartsData: {
                revenueByDay: revenueByDayResult.rows,
                revenueByCategory: revenueByCategoryResult.rows,
                salesByCity: salesByCityResult.rows
            },
            recentOrders: recentOrders.rows,
            recentUsers: recentUsers.rows,
            activities: activities.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Dashboard error: ' + err.message);
    }
});

/* ===============================
   ANALYTICS
=============================== */
router.get('/analytics', isAdmin, async (req, res) => {
    try {
        const period = parseInt(req.query.period) || 30;

        const [
            revenueByDayResult,
            ordersByStatusResult,
            newUsersChartResult,
            revenueByCategoryResult,
            topProductsResult,
            avgOrderValueResult
        ] = await Promise.all([

            // Revenue + order count per day for the period
            pool.query(`
                SELECT
                    TO_CHAR(created_at, 'DD Mon') AS day,
                    COALESCE(SUM(total_amount), 0) AS revenue,
                    COUNT(*) AS order_count
                FROM orders
                WHERE status != 'Cancelled'
                  AND created_at >= NOW() - INTERVAL '${period} days'
                GROUP BY TO_CHAR(created_at, 'DD Mon'), DATE(created_at)
                ORDER BY DATE(created_at) ASC
            `),

            // Orders grouped by status
            pool.query(`
                SELECT status, COUNT(*) AS count
                FROM orders
                WHERE created_at >= NOW() - INTERVAL '${period} days'
                GROUP BY status
                ORDER BY count DESC
            `),

            // New users per day
            pool.query(`
                SELECT
                    TO_CHAR(created_at, 'DD Mon') AS day,
                    COUNT(*) AS users
                FROM users
                WHERE created_at >= NOW() - INTERVAL '${period} days'
                GROUP BY TO_CHAR(created_at, 'DD Mon'), DATE(created_at)
                ORDER BY DATE(created_at) ASC
            `),

            // Revenue by category
            pool.query(`
                SELECT
                    COALESCE(categories.name, 'Uncategorised') AS category,
                    COALESCE(SUM(order_items.price * order_items.quantity), 0) AS revenue
                FROM order_items
                JOIN products        ON products.id   = order_items.product_id
                LEFT JOIN categories ON categories.id = products.category_id
                JOIN orders          ON orders.id     = order_items.order_id
                WHERE orders.status != 'Cancelled'
                  AND orders.created_at >= NOW() - INTERVAL '${period} days'
                GROUP BY COALESCE(categories.name, 'Uncategorised')
                ORDER BY revenue DESC
                LIMIT 8
            `),

            // Top selling products
            pool.query(`
                SELECT
                    products.id,
                    products.name,
                    products.price,
                    products.stock,
                    SUM(order_items.quantity) AS total_sold,
                    SUM(order_items.price * order_items.quantity) AS total_revenue
                FROM order_items
                JOIN products ON products.id = order_items.product_id
                JOIN orders   ON orders.id   = order_items.order_id
                WHERE orders.status != 'Cancelled'
                  AND orders.created_at >= NOW() - INTERVAL '${period} days'
                GROUP BY products.id, products.name, products.price, products.stock
                ORDER BY total_sold DESC
                LIMIT 10
            `),

            // Average order value
            pool.query(`
                SELECT COALESCE(AVG(total_amount), 0) AS avg_value
                FROM orders
                WHERE status != 'Cancelled'
                  AND created_at >= NOW() - INTERVAL '${period} days'
            `)
        ]);

        res.render('admin/analytics', {
            title: 'Analytics',
            user: req.session.user,
            period,
            revenueByDay: revenueByDayResult.rows,
            ordersByStatus: ordersByStatusResult.rows,
            newUsersChart: newUsersChartResult.rows,
            revenueByCategory: revenueByCategoryResult.rows,
            topProducts: topProductsResult.rows,
            avgOrderValue: Math.round(Number(avgOrderValueResult.rows[0].avg_value))
        });

    } catch (err) {
        console.error('Analytics error:', err);
        res.status(500).send('Analytics error: ' + err.message);
    }
});

/* ===============================
   PRODUCTS
=============================== */
router.get('/products', isStaff, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const { search, category, stock_filter } = req.query;

        let query = `SELECT products.*, categories.name AS category_name
                     FROM products 
                     LEFT JOIN categories ON categories.id = products.category_id`;
        let countQuery = `SELECT COUNT(*) FROM products`;
        const params = [];
        const where = [];

        if (search) {
            params.push(`%${search}%`);
            where.push(`products.name ILIKE $${params.length}`);
        }
        if (category) {
            params.push(category);
            where.push(`products.category_id = $${params.length}`);
        }
        if (stock_filter === 'low') {
            where.push(`products.stock <= 5 AND products.stock > 0`);
        } else if (stock_filter === 'out') {
            where.push(`products.stock = 0`);
        }

        if (where.length > 0) {
            const whereClause = ' WHERE ' + where.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ` ORDER BY products.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const totalCountRes = await pool.query(countQuery, params);
        const totalCount = parseInt(totalCountRes.rows[0].count);

        params.push(limit, offset);
        const products = await pool.query(query, params);
        const categories = await pool.query("SELECT * FROM categories ORDER BY name");

        res.render('admin/products', {
            title: 'Products',
            user: req.session.user,
            products: products.rows,
            categories: categories.rows,
            defaultWeightOptions: DEFAULT_WEIGHT_OPTIONS,
            defaultCheckedWeightOptions: ['100gm', '250gm', '500gm', '750gm', '1kg'],
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            currentPage: page,
            search: search || '',
            selectedCategory: category || '',
            stockFilter: stock_filter || '',
            error: req.query.error || null,
            success: req.query.success || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error: ' + err.message);
    }
});

router.get('/products/low-stock', isStaff, async (req, res) => {
    try {
        const threshold = parseInt(req.query.threshold) || 10;
        const products = await pool.query(
            `SELECT p.*, c.name AS category_name 
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.stock <= $1
             ORDER BY p.stock ASC`,
            [threshold]
        );
        res.render('admin/low-stock', {
            title: 'Low Stock Alerts',
            user: req.session.user,
            products: products.rows,
            threshold
        });
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

/* ===============================
   ADMIN PROFILE
=============================== */
router.get('/profile', isAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, full_name AS name, email, phone, created_at FROM users WHERE id = $1",
            [req.session.user.id]
        );
        res.render('admin/profile', {
            title: 'Admin Profile',
            user: req.session.user,
            adminUser: result.rows[0],
            error: req.query.error || null,
            success: req.query.success || null
        });
    } catch (err) {
        res.redirect('/admin/dashboard?error=Profile error');
    }
});

router.post('/profile/update', isAdmin, async (req, res) => {
    try {
        const { name, phone } = req.body;
        await pool.query(
            "UPDATE users SET full_name = $1, phone = $2 WHERE id = $3",
            [name, phone || null, req.session.user.id]
        );
        req.session.user.name = name;
        res.redirect('/admin/profile?success=Profile updated');
    } catch (err) {
        res.redirect('/admin/profile?error=' + encodeURIComponent(err.message));
    }
});

router.post('/profile/change-password', isAdmin, async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = req.body;
        if (new_password !== confirm_password) {
            return res.redirect('/admin/profile?error=Passwords do not match');
        }

        const user = await pool.query("SELECT password FROM users WHERE id = $1", [req.session.user.id]);
        const isMatch = await require('bcrypt').compare(current_password, user.rows[0].password);
        if (!isMatch) {
            return res.redirect('/admin/profile?error=Current password incorrect');
        }

        const hashed = await require('bcrypt').hash(new_password, 12);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, req.session.user.id]);
        res.redirect('/admin/profile?success=Password updated');
    } catch (err) {
        res.redirect('/admin/profile?error=' + encodeURIComponent(err.message));
    }
});

router.post('/products/add', isAdmin, addProductUploadMiddleware, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const { name, description, price, stock, category_id, image, price_type, offer_percent, offer_active } = req.body;
        const normalizedPriceType = price_type || 'unit';
        const availableWeights = parseAvailableWeightsFromBody(req.body, normalizedPriceType);
        if (normalizedPriceType === 'kg' && availableWeights.length === 0) {
            return res.redirect('/admin/products?error=Select at least one weight option for KG products');
        }

        const uploadedImageUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const baseName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                const url = await processMediaFile(file, productUploadDir, baseName);
                uploadedImageUrls.push(url);
            }
        }

        const imageUrl = String(image || '').trim();
        const galleryImages = [];
        if (imageUrl) galleryImages.push(imageUrl);
        galleryImages.push(...uploadedImageUrls);
        const mainImage = imageUrl || uploadedImageUrls[0] || null;

        const parsedOffer = Math.max(1, Math.min(100, parseFloat(offer_percent || 1)));
        const parsedStock = Math.max(0, parseInt(stock) || 0);
        await client.query('BEGIN');
        const result = await client.query(
            "INSERT INTO products (name, description, price, stock, category_id, image, price_type, offer_percent, offer_active, available_weights) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
            [name, description, parseFloat(price), parsedStock, category_id || null, mainImage, normalizedPriceType, parsedOffer, offer_active ? true : false, JSON.stringify(availableWeights)]
        );
        await addProductImages(client, result.rows[0].id, galleryImages, mainImage);
        await client.query('COMMIT');
        await logActivity(req.session.user.id, "Added Product", { name, price });
        res.redirect('/admin/products?success=Product added');
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_e) { /* ignore */ }
        }
        res.redirect('/admin/products?error=' + encodeURIComponent(err.message));
    } finally {
        if (client) client.release();
    }
});

router.post('/products/toggle-enabled/:id', isStaff, async (req, res) => {
    try {
        await pool.query(
            "UPDATE products SET is_enabled = NOT COALESCE(is_enabled, true) WHERE id = $1",
            [req.params.id]
        );
        await logActivity(req.session.user.id, "Toggled Product Visibility", { id: req.params.id });
        res.redirect('/admin/products?success=Product visibility updated');
    } catch (err) {
        res.redirect('/admin/products?error=' + encodeURIComponent(err.message));
    }
});

router.get('/products/edit/:id', isStaff, async (req, res) => {
    try {
        const [product, categories, productImages] = await Promise.all([
            pool.query("SELECT * FROM products WHERE id=$1", [req.params.id]),
            pool.query("SELECT * FROM categories ORDER BY name"),
            pool.query(
                "SELECT * FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, created_at ASC",
                [req.params.id]
            )
        ]);
        if (!product.rows.length) return res.redirect('/admin/products?error=Not found');
        const productData = product.rows[0];
        res.render('admin/product-edit', {
            title: 'Edit Product', user: req.session.user,
            product: productData,
            categories: categories.rows,
            productImages: productImages.rows,
            defaultWeightOptions: DEFAULT_WEIGHT_OPTIONS,
            productWeightOptions: getProductWeightOptions(productData),
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) { res.redirect('/admin/products?error=' + encodeURIComponent(err.message)); }
});

router.post('/products/edit/:id', isStaff, editProductUploadMiddleware, async (req, res) => {
    let client;
    try {
        const { name, description, price, stock, category_id, image, price_type, offer_percent, offer_active } = req.body;
        const normalizedPriceType = price_type || 'unit';
        const availableWeights = parseAvailableWeightsFromBody(req.body, normalizedPriceType);
        if (normalizedPriceType === 'kg' && availableWeights.length === 0) {
            return res.redirect('/admin/products/edit/' + req.params.id + '?error=Select at least one weight option for KG products');
        }

        client = await pool.connect();
        await client.query('BEGIN');

        const existingProductResult = await client.query(
            "SELECT offer_percent, offer_active, image FROM products WHERE id = $1",
            [req.params.id]
        );
        if (!existingProductResult.rows.length) {
            await client.query('ROLLBACK');
            return res.redirect('/admin/products?error=Product not found');
        }
        const existingProduct = existingProductResult.rows[0];

        let parsedOffer = Math.max(1, Math.min(100, parseFloat(offer_percent || 1)));
        let parsedOfferActive = offer_active ? true : false;
        if (req.session.user.role !== 'admin') {
            parsedOffer = Number(existingProduct.offer_percent || 0);
            parsedOfferActive = !!existingProduct.offer_active;
        }

        const imageUrl = String(image || '').trim();
        const uploadedImageUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const baseName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                const url = await processMediaFile(file, productUploadDir, baseName);
                uploadedImageUrls.push(url);
            }
        }

        const mainImage = imageUrl || existingProduct.image || uploadedImageUrls[0] || null;
        const galleryImages = [];
        if (imageUrl) galleryImages.push(imageUrl);
        galleryImages.push(...uploadedImageUrls);

        const parsedStock = Math.max(0, parseInt(stock) || 0);
        await client.query(
            "UPDATE products SET name=$1, description=$2, price=$3, stock=$4, category_id=$5, image=$6, price_type=$7, offer_percent=$8, offer_active=$9, available_weights=$10 WHERE id=$11",
            [name, description, parseFloat(price), parsedStock, category_id || null, mainImage, normalizedPriceType, parsedOffer, parsedOfferActive, JSON.stringify(availableWeights), req.params.id]
        );

        await addProductImages(client, req.params.id, galleryImages, mainImage);
        await client.query('COMMIT');

        await logActivity(req.session.user.id, "Updated Product", { id: req.params.id, name });
        res.redirect('/admin/products?success=Product updated');
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_e) { /* ignore */ }
        }
        res.redirect('/admin/products/edit/' + req.params.id + '?error=' + encodeURIComponent(err.message));
    } finally {
        if (client) client.release();
    }
});

router.post('/products/images/delete/:imageId', isStaff, async (req, res) => {
    try {
        const imageId = parseInt(req.params.imageId, 10);
        if (!Number.isInteger(imageId) || imageId <= 0) {
            return res.redirect('/admin/products?error=Invalid image id');
        }

        const imageResult = await pool.query(
            "SELECT id, product_id FROM product_images WHERE id = $1",
            [imageId]
        );
        if (!imageResult.rows.length) {
            return res.redirect('/admin/products?error=Image not found');
        }
        const productId = imageResult.rows[0].product_id;

        await pool.query("DELETE FROM product_images WHERE id = $1", [imageId]);

        const remaining = await pool.query(
            "SELECT id, image_url, is_primary FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, created_at ASC",
            [productId]
        );

        if (remaining.rows.length > 0) {
            let primary = remaining.rows.find((row) => row.is_primary);
            if (!primary) {
                await pool.query("UPDATE product_images SET is_primary = true WHERE id = $1", [remaining.rows[0].id]);
                primary = remaining.rows[0];
            }
            await pool.query("UPDATE products SET image = $1 WHERE id = $2", [primary.image_url, productId]);
        } else {
            await pool.query("UPDATE products SET image = NULL WHERE id = $1", [productId]);
        }

        await logActivity(req.session.user.id, "Deleted Product Image", { imageId, productId });
        return res.redirect('/admin/products/edit/' + productId + '?success=Product image deleted');
    } catch (err) {
        return res.redirect('/admin/products?error=' + encodeURIComponent(err.message));
    }
});

/* ===============================
   OFFERS & COUPONS
=============================== */
router.get('/offers', isAdmin, async (req, res) => {
    try {
        const { search } = req.query;
        const params = [];
        let whereSql = '';
        if (search && search.trim()) {
            params.push(`%${search.trim()}%`);
            whereSql = `WHERE p.name ILIKE $1`;
        }

        const [products, coupons, categories] = await Promise.all([
            pool.query(
                `SELECT p.id, p.name, p.price, p.offer_percent, p.offer_active, p.stock, p.category_id, c.name AS category_name
                 FROM products p
                 LEFT JOIN categories c ON c.id = p.category_id
                 ${whereSql}
                 ORDER BY p.created_at DESC
                 LIMIT 200`,
                params
            ),
            pool.query(
                `SELECT cp.*, u.full_name AS created_by_name
                 FROM coupons cp
                 LEFT JOIN users u ON u.id = cp.created_by
                 ORDER BY cp.created_at DESC`
            ),
            pool.query("SELECT id, name FROM categories ORDER BY name")
        ]);

        res.render('admin/offers', {
            title: 'Offers',
            user: req.session.user,
            products: products.rows,
            coupons: coupons.rows,
            categories: categories.rows,
            search: search || '',
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        res.redirect('/admin/dashboard?error=' + encodeURIComponent(err.message));
    }
});

router.post('/offers/product/:id', isAdmin, async (req, res) => {
    try {
        const offerPercent = Math.max(1, Math.min(100, parseFloat(req.body.offer_percent || 1)));
        const offerActive = req.body.offer_active === 'on' || req.body.offer_active === 'true';

        await pool.query(
            `UPDATE products
             SET offer_percent = $1, offer_active = $2
             WHERE id = $3`,
            [offerPercent, offerActive, req.params.id]
        );

        await logActivity(req.session.user.id, "Updated Product Offer", {
            productId: req.params.id,
            offer_percent: offerPercent,
            offer_active: offerActive
        });

        res.redirect('/admin/offers?success=Product offer updated');
    } catch (err) {
        res.redirect('/admin/offers?error=' + encodeURIComponent(err.message));
    }
});

router.post('/coupons/add', isAdmin, async (req, res) => {
    try {
        const {
            code,
            description,
            discount_type,
            discount_value,
            min_order_amount,
            starts_at,
            ends_at,
            usage_limit,
            is_active,
            applicable_product_ids,
            applicable_category_ids
        } = req.body;
        const cleanCode = String(code || '').trim().toUpperCase();

        if (!cleanCode) return res.redirect('/admin/offers?error=Coupon code is required');
        if (!['percent', 'fixed'].includes(discount_type)) return res.redirect('/admin/offers?error=Invalid discount type');

        const value = parseFloat(discount_value || 0);
        if (Number.isNaN(value) || value <= 0) return res.redirect('/admin/offers?error=Discount value must be greater than 0');
        if (discount_type === 'percent' && value > 100) return res.redirect('/admin/offers?error=Percent discount cannot exceed 100');

        const now = new Date();
        const startAt = starts_at ? new Date(starts_at) : now;
        const endAt = ends_at ? new Date(ends_at) : null;
        if (Number.isNaN(startAt.getTime())) return res.redirect('/admin/offers?error=Invalid start date');
        if (endAt && Number.isNaN(endAt.getTime())) return res.redirect('/admin/offers?error=Invalid end date');
        if (endAt && endAt.getTime() < now.getTime()) return res.redirect('/admin/offers?error=Coupon end date must be today or in the future');
        if (endAt && endAt.getTime() < startAt.getTime()) return res.redirect('/admin/offers?error=End date must be after start date');

        const selectedProductIds = parsePositiveIntList(applicable_product_ids);
        const selectedCategoryIds = parsePositiveIntList(applicable_category_ids);

        await pool.query(
            `INSERT INTO coupons
             (code, description, discount_type, discount_value, min_order_amount, applicable_product_ids, applicable_category_ids, starts_at, ends_at, usage_limit, is_active, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
                cleanCode,
                description || null,
                discount_type,
                value,
                parseFloat(min_order_amount || 0),
                selectedProductIds.length ? selectedProductIds : null,
                selectedCategoryIds.length ? selectedCategoryIds : null,
                startAt.toISOString(),
                endAt ? endAt.toISOString() : null,
                usage_limit ? parseInt(usage_limit) : null,
                is_active === 'on' || is_active === 'true',
                req.session.user.id
            ]
        );

        await logActivity(req.session.user.id, "Created Coupon", {
            code: cleanCode,
            discount_type,
            value,
            restricted_products: selectedProductIds.length,
            restricted_categories: selectedCategoryIds.length
        });
        res.redirect('/admin/offers?success=Coupon created');
    } catch (err) {
        res.redirect('/admin/offers?error=' + encodeURIComponent(err.message));
    }
});

router.post('/coupons/toggle/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE coupons SET is_active = NOT is_active WHERE id = $1", [req.params.id]);
        await logActivity(req.session.user.id, "Toggled Coupon", { couponId: req.params.id });
        res.redirect('/admin/offers?success=Coupon status updated');
    } catch (err) {
        res.redirect('/admin/offers?error=' + encodeURIComponent(err.message));
    }
});

router.post('/coupons/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM coupons WHERE id = $1", [req.params.id]);
        await logActivity(req.session.user.id, "Deleted Coupon", { couponId: req.params.id });
        res.redirect('/admin/offers?success=Coupon deleted');
    } catch (err) {
        res.redirect('/admin/offers?error=' + encodeURIComponent(err.message));
    }
});

router.post('/products/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
        res.redirect('/admin/products?success=Product deleted');
    } catch (err) { res.redirect('/admin/products?error=' + encodeURIComponent(err.message)); }
});

router.post('/products/bulk', isStaff, async (req, res) => {
    try {
        const idsRaw = req.body.product_ids;
        const action = req.body.action;
        const ids = Array.isArray(idsRaw) ? idsRaw.map((v) => parseInt(v, 10)).filter(Boolean) : [parseInt(idsRaw, 10)].filter(Boolean);

        if (!ids.length) return res.redirect('/admin/products?error=No products selected');
        if (!action) return res.redirect('/admin/products?error=No bulk action selected');

        if (action === 'delete') {
            if (req.session.user.role !== 'admin') {
                return res.redirect('/admin/products?error=Only admin can bulk delete products');
            }
            await pool.query("DELETE FROM products WHERE id = ANY($1::int[])", [ids]);
            await logActivity(req.session.user.id, "Bulk Deleted Products", { count: ids.length });
            return res.redirect('/admin/products?success=Selected products deleted');
        }

        if (action === 'update_stock') {
            const stock = parseInt(req.body.bulk_stock, 10);
            if (Number.isNaN(stock) || stock < 0) {
                return res.redirect('/admin/products?error=Invalid stock quantity');
            }
            await pool.query("UPDATE products SET stock = $1 WHERE id = ANY($2::int[])", [stock, ids]);
            await logActivity(req.session.user.id, "Bulk Updated Stock", { count: ids.length, stock });
            return res.redirect('/admin/products?success=Stock updated for selected products');
        }

        if (action === 'out_of_stock') {
            await pool.query("UPDATE products SET stock = 0 WHERE id = ANY($1::int[])", [ids]);
            await logActivity(req.session.user.id, "Bulk Marked Out Of Stock", { count: ids.length });
            return res.redirect('/admin/products?success=Selected products marked out of stock');
        }

        if (action === 'enable') {
            await pool.query("UPDATE products SET is_enabled = true WHERE id = ANY($1::int[])", [ids]);
            await logActivity(req.session.user.id, "Bulk Enabled Products", { count: ids.length });
            return res.redirect('/admin/products?success=Selected products enabled');
        }

        if (action === 'disable') {
            await pool.query("UPDATE products SET is_enabled = false WHERE id = ANY($1::int[])", [ids]);
            await logActivity(req.session.user.id, "Bulk Disabled Products", { count: ids.length });
            return res.redirect('/admin/products?success=Selected products disabled');
        }

        return res.redirect('/admin/products?error=Unsupported bulk action');
    } catch (err) {
        return res.redirect('/admin/products?error=' + encodeURIComponent(err.message));
    }
});

/* ===============================
   CATEGORIES
=============================== */
router.get('/categories', isAdmin, async (req, res) => {
    try {
        const categories = await pool.query(
            `SELECT categories.*, COUNT(products.id) AS product_count
             FROM categories LEFT JOIN products ON products.category_id = categories.id
             GROUP BY categories.id ORDER BY categories.name`
        );
        res.render('admin/categories', {
            title: 'Categories', user: req.session.user,
            categories: categories.rows,
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.post('/categories/add', isAdmin, async (req, res) => {
    try {
        const { name, description, image } = req.body;
        await pool.query("INSERT INTO categories (name, description, image) VALUES ($1,$2,$3)",
            [name, description || null, image || null]);
        res.redirect('/admin/categories?success=Category added');
    } catch (err) { res.redirect('/admin/categories?error=' + encodeURIComponent(err.message)); }
});

router.post('/categories/edit/:id', isAdmin, async (req, res) => {
    try {
        const { name, description, image } = req.body;
        await pool.query("UPDATE categories SET name=$1, description=$2, image=$3 WHERE id=$4",
            [name, description || null, image || null, req.params.id]);
        res.redirect('/admin/categories?success=Category updated');
    } catch (err) { res.redirect('/admin/categories?error=' + encodeURIComponent(err.message)); }
});

router.post('/categories/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM categories WHERE id=$1", [req.params.id]);
        res.redirect('/admin/categories?success=Category deleted');
    } catch (err) { res.redirect('/admin/categories?error=' + encodeURIComponent(err.message)); }
});

/* ===============================
   ORDERS
=============================== */
router.get('/orders', isStaff, async (req, res) => {
    try {
        const { status, search } = req.query;
        let q = `SELECT orders.*, users.full_name AS user_name, users.email AS user_email, users.phone AS user_phone\n                 FROM orders JOIN users ON users.id = orders.user_id`;
        const params = [];
        const where = [];
        if (status && status !== 'all') { params.push(status); where.push(`orders.status=$${params.length}`); }
        if (search) {
            params.push(`%${search}%`);
            where.push(`(users.full_name ILIKE $${params.length} OR users.email ILIKE $${params.length} OR CAST(orders.id AS TEXT) ILIKE $${params.length})`);
        }
        if (where.length) q += ' WHERE ' + where.join(' AND ');
        q += ' ORDER BY orders.created_at DESC';
        const orders = await pool.query(q, params);
        res.render('admin/orders', {
            title: 'Orders', user: req.session.user,
            orders: orders.rows, currentStatus: status || 'all', search: search || '',
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.post('/orders/status/:id', isStaff, async (req, res) => {
    try {
        const { status, estimated_delivery_at, delivery_note } = req.body;
        const eta = estimated_delivery_at && String(estimated_delivery_at).trim().length
            ? new Date(estimated_delivery_at)
            : null;
        if (eta && Number.isNaN(eta.getTime())) {
            return res.redirect('/admin/orders?error=Invalid delivery date/time');
        }

        const existingOrder = await pool.query("SELECT status FROM orders WHERE id=$1", [req.params.id]);
        if (existingOrder.rows.length && existingOrder.rows[0].status === 'Cancelled') {
            return res.redirect('/admin/orders?error=Cannot update a cancelled order');
        }

        await pool.query(
            `UPDATE orders
             SET status=$1,
                 estimated_delivery_at=$2,
                 delivery_note=$3,
                 delivered_at = CASE
                    WHEN $1 = 'Delivered' THEN COALESCE(delivered_at, NOW())
                    WHEN $1 <> 'Delivered' THEN NULL
                    ELSE delivered_at
                 END
             WHERE id=$4`,
            [status, eta ? eta.toISOString() : null, delivery_note || null, req.params.id]
        );
        await logActivity(req.session.user.id, "Updated Order Status", {
            id: req.params.id,
            status,
            estimated_delivery_at: eta ? eta.toISOString() : null
        });
        res.redirect('/admin/orders?success=Order status updated');
    } catch (err) { res.redirect('/admin/orders?error=' + encodeURIComponent(err.message)); }
});

router.get('/orders/cancelled', isStaff, async (req, res) => {
    try {
        const { search } = req.query;
        let q = `SELECT orders.*, users.full_name AS user_name, users.email AS user_email
                 FROM orders
                 JOIN users ON users.id = orders.user_id
                 WHERE orders.status = 'Cancelled'`;
        const params = [];
        if (search) {
            params.push(`%${search}%`);
            q += ` AND (users.full_name ILIKE $1 OR users.email ILIKE $1 OR CAST(orders.id AS TEXT) ILIKE $1)`;
        }
        q += ' ORDER BY orders.created_at DESC';
        const orders = await pool.query(q, params);
        res.render('admin/cancelled-orders', {
            title: 'Cancelled Orders',
            user: req.session.user,
            orders: orders.rows,
            search: search || '',
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        res.redirect('/admin/orders?error=' + encodeURIComponent(err.message));
    }
});

router.get('/orders/:id', isStaff, async (req, res) => {
    try {
        const order = await pool.query(
            `SELECT orders.*, users.full_name AS user_name, users.email AS user_email, users.phone AS user_phone
             FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id=$1`, [req.params.id]);
        if (!order.rows.length) return res.redirect('/admin/orders?error=Not found');
        const items = await pool.query(
            `SELECT order_items.*, products.name, products.image
             FROM order_items JOIN products ON products.id = order_items.product_id
             WHERE order_items.order_id=$1`, [req.params.id]);
        const returnReq = await pool.query(
            "SELECT * FROM returns WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
            [req.params.id]
        );
        res.render('admin/order-detail', {
            title: 'Order Detail', user: req.session.user,
            order: order.rows[0], items: items.rows,
            returnRequest: returnReq.rows[0] || null
        });
    } catch (err) { res.redirect('/admin/orders?error=' + encodeURIComponent(err.message)); }
});

router.get('/orders/:id/bill', isStaff, async (req, res) => {
    try {
        const orderResult = await pool.query(
            `SELECT orders.*, users.full_name AS user_name, users.email AS user_email, users.phone AS user_phone
             FROM orders
             JOIN users ON users.id = orders.user_id
             WHERE orders.id = $1`,
            [req.params.id]
        );

        if (!orderResult.rows.length) {
            return res.redirect('/admin/orders?error=Order not found');
        }

        const itemsResult = await pool.query(
            `SELECT oi.*, p.name
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = $1
             ORDER BY oi.id ASC`,
            [req.params.id]
        );

        const items = itemsResult.rows;
        const subtotal = items.reduce((sum, i) => sum + (Number(i.price) * Number(i.quantity)), 0);
        const total = Number(orderResult.rows[0].total_amount || 0);
        const discount = Math.max(0, subtotal - total);

        res.render('admin/order-bill', {
            title: `Order Bill #${req.params.id}`,
            user: req.session.user,
            order: orderResult.rows[0],
            items,
            subtotal,
            discount,
            total
        });
    } catch (err) {
        return res.redirect('/admin/orders?error=' + encodeURIComponent(err.message));
    }
});

/* ===============================
   USERS
=============================== */
router.get('/users', isAdmin, async (req, res) => {
    try {
        const { search, role } = req.query;
        let q = `SELECT users.id, users.full_name AS name, users.email, users.phone, users.role, users.is_blocked, users.created_at, COUNT(orders.id) AS order_count
                 FROM users LEFT JOIN orders ON orders.user_id = users.id`;
        const params = [];
        const where = [];

        if (search) {
            params.push(`%${search}%`);
            where.push(`(users.full_name ILIKE $${params.length} OR users.email ILIKE $${params.length})`);
        }
        if (role && ['user', 'staff'].includes(role)) {
            params.push(role);
            where.push(`users.role = $${params.length}`);
        }
        if (where.length) q += ` WHERE ${where.join(' AND ')}`;
        q += ' GROUP BY users.id ORDER BY users.created_at DESC';

        const users = await pool.query(q, params);
        res.render('admin/users', {
            title: 'Users', user: req.session.user,
            users: users.rows, search: search || '', selectedRole: role || 'all',
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.post('/users/toggle/:id', isAdmin, async (req, res) => {
    try {
        const target = await pool.query("SELECT id, role FROM users WHERE id = $1", [req.params.id]);
        if (!target.rows.length) return res.redirect('/admin/users?error=User not found');
        if (target.rows[0].role === 'admin') {
            return res.redirect('/admin/users?error=Admin accounts are protected');
        }
        await pool.query("UPDATE users SET is_blocked = NOT COALESCE(is_blocked, false) WHERE id=$1", [req.params.id]);
        res.redirect('/admin/users?success=User status updated');
    } catch (err) { res.redirect('/admin/users?error=' + encodeURIComponent(err.message)); }
});

router.post('/users/role/:id', isAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        if (!['user', 'staff', 'admin'].includes(role)) {
            return res.redirect('/admin/users?error=Invalid role specified');
        }
        const target = await pool.query("SELECT id, role FROM users WHERE id = $1", [req.params.id]);
        if (!target.rows.length) return res.redirect('/admin/users?error=User not found');
        if (target.rows[0].role === 'admin') {
            return res.redirect('/admin/users?error=Admin accounts are protected');
        }
        await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, req.params.id]);
        await logActivity(req.session.user.id, "Updated User Role", { userId: req.params.id, role });
        res.redirect('/admin/users?success=User role updated to ' + role);
    } catch (err) {
        res.redirect('/admin/users?error=' + encodeURIComponent(err.message));
    }
});


// ==========================================
// STAFF ONBOARDING
// ==========================================
router.post('/staff/add', isAdmin, async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) return res.redirect('/admin/users?error=Missing fields');

        const newRole = role === 'admin' ? 'admin' : 'staff';
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 12);

        await pool.query(
            "INSERT INTO users (full_name, email, password, role) VALUES ($1, $2, $3, $4)",
            [name, email, hashedPassword, newRole]
        );

        await logActivity(req.session.user.id, `Onboarded ${newRole}`, { email });
        res.redirect(`/admin/users?success=${newRole === 'admin' ? 'Admin' : 'Staff'} added successfully`);
    } catch (err) { res.redirect('/admin/users?error=' + encodeURIComponent(err.message)); }
});

router.post('/staff/password/:id', isAdmin, async (req, res) => {
    try {
        const { new_password, confirm_password } = req.body;
        if (!new_password || new_password.length < 6) {
            return res.redirect('/admin/users?error=Password must be at least 6 characters');
        }
        if (new_password !== confirm_password) {
            return res.redirect('/admin/users?error=Passwords do not match');
        }
        const target = await pool.query("SELECT id, role, email FROM users WHERE id = $1", [req.params.id]);
        if (!target.rows.length) return res.redirect('/admin/users?error=User not found');
        if (target.rows[0].role !== 'staff') {
            return res.redirect('/admin/users?error=Only staff passwords can be changed here');
        }

        const bcrypt = require('bcrypt');
        const hashed = await bcrypt.hash(new_password, 12);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, req.params.id]);
        await logActivity(req.session.user.id, "Reset Staff Password", { staffId: req.params.id });

        return res.redirect('/admin/users?success=Staff password updated');
    } catch (err) {
        return res.redirect('/admin/users?error=' + encodeURIComponent(err.message));
    }
});

// ==========================================
// USER REMOVAL
// ==========================================
router.post('/users/delete/:id', isAdmin, async (req, res) => {
    try {
        const target = await pool.query("SELECT id, role FROM users WHERE id = $1", [req.params.id]);
        if (!target.rows.length) return res.redirect('/admin/users?error=User not found');
        if (target.rows[0].role === 'admin') {
            return res.redirect('/admin/users?error=Admin accounts are protected');
        }
        await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
        await logActivity(req.session.user.id, "Deleted User/Staff", { id: req.params.id });
        res.redirect('/admin/users?success=User removed successfully');
    } catch (err) { res.redirect('/admin/users?error=Failed to remove user'); }
});

router.get('/staff-management', isAdmin, async (req, res) => {
    try {
        const [staffResult, loginStatsResult, recentActivityResult] = await Promise.all([
            pool.query(
                `SELECT u.id, u.full_name AS name, u.email, u.phone, u.is_blocked, u.created_at, u.last_active,
                        COALESCE((SELECT COUNT(*) FROM staff_activities sa WHERE sa.user_id = u.id), 0) AS activity_count
                 FROM users u
                 WHERE u.role = 'staff'
                 ORDER BY u.created_at DESC`
            ),
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE action IN ('Staff Login', 'Admin Login')) AS total_logins,
                    COUNT(*) FILTER (WHERE action IN ('Staff Logout', 'Admin Logout')) AS total_logouts,
                    COUNT(*) FILTER (WHERE action = 'Staff Login') AS staff_logins,
                    COUNT(*) FILTER (WHERE action = 'Staff Logout') AS staff_logouts
                 FROM staff_activities`
            ),
            pool.query(
                `SELECT sa.*, u.full_name AS user_name, u.email AS user_email
                 FROM staff_activities sa
                 LEFT JOIN users u ON u.id = sa.user_id
                 WHERE sa.action IN ('Staff Login', 'Staff Logout', 'Admin Login', 'Admin Logout')
                 ORDER BY sa.timestamp DESC
                 LIMIT 120`
            )
        ]);

        const staff = staffResult.rows;
        const blockedCount = staff.filter((s) => s.is_blocked).length;
        const activeCount = staff.length - blockedCount;

        res.render('admin/staff-management', {
            title: 'Staff Management',
            user: req.session.user,
            staff,
            stats: {
                totalStaff: staff.length,
                activeStaff: activeCount,
                blockedStaff: blockedCount,
                totalLogins: Number(loginStatsResult.rows[0]?.total_logins || 0),
                totalLogouts: Number(loginStatsResult.rows[0]?.total_logouts || 0),
                staffLogins: Number(loginStatsResult.rows[0]?.staff_logins || 0),
                staffLogouts: Number(loginStatsResult.rows[0]?.staff_logouts || 0)
            },
            recentActivity: recentActivityResult.rows,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        res.redirect('/admin/dashboard?error=' + encodeURIComponent(err.message));
    }
});

router.get('/staff', isAdmin, (req, res) => {
    return res.redirect('/admin/staff-management');
});

router.post('/staff/toggle/:id', isAdmin, async (req, res) => {
    try {
        const target = await pool.query("SELECT id, role, is_blocked FROM users WHERE id = $1", [req.params.id]);
        if (!target.rows.length) return res.redirect('/admin/staff-management?error=Staff user not found');
        if (target.rows[0].role !== 'staff') {
            return res.redirect('/admin/staff-management?error=Only staff accounts can be managed here');
        }

        await pool.query("UPDATE users SET is_blocked = NOT COALESCE(is_blocked, false) WHERE id = $1", [req.params.id]);
        await logActivity(req.session.user.id, "Toggled Staff Account", {
            staffId: req.params.id,
            blocked: !target.rows[0].is_blocked
        });

        return res.redirect('/admin/staff-management?success=Staff account status updated');
    } catch (err) {
        return res.redirect('/admin/staff-management?error=' + encodeURIComponent(err.message));
    }
});

router.get('/banners', isAdmin, async (req, res) => {
    try {
        const banners = await pool.query("SELECT * FROM banners ORDER BY position ASC");
        res.render('admin/banners', {
            title: 'Banners', user: req.session.user,
            banners: banners.rows,
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) { res.status(500).send('Error: ' + err.message); }
});

const bannerUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'banners');

router.post('/banners/add', isAdmin, productImageUpload.single('image_file'), async (req, res) => {
    try {
        const { title, subtitle, link, position } = req.body;
        let image = req.body.image;
        if (req.file) {
            const baseName = `banner-${Date.now()}`;
            image = await processMediaFile(req.file, bannerUploadDir, baseName);
        }
        await pool.query("INSERT INTO banners (title, subtitle, image, link, position, is_active) VALUES ($1,$2,$3,$4,$5,true)",
            [title, subtitle || null, image, link || null, position || 0]);
        res.redirect('/admin/banners?success=Banner added');
    } catch (err) { res.redirect('/admin/banners?error=' + encodeURIComponent(err.message)); }
});

router.post('/banners/edit/:id', isAdmin, productImageUpload.single('image_file'), async (req, res) => {
    try {
        const { title, subtitle, link, position } = req.body;
        let image = req.body.image;
        if (req.file) {
            const baseName = `banner-${Date.now()}`;
            image = await processMediaFile(req.file, bannerUploadDir, baseName);
        }
        await pool.query("UPDATE banners SET title=$1, subtitle=$2, image=$3, link=$4, position=$5 WHERE id=$6",
            [title, subtitle || null, image, link || null, position || 0, req.params.id]);
        res.redirect('/admin/banners?success=Banner updated');
    } catch (err) { res.redirect('/admin/banners?error=' + encodeURIComponent(err.message)); }
});

router.post('/banners/toggle/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE banners SET is_active = NOT is_active WHERE id=$1", [req.params.id]);
        res.redirect('/admin/banners?success=Banner toggled');
    } catch (err) { res.redirect('/admin/banners?error=' + encodeURIComponent(err.message)); }
});

router.post('/banners/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM banners WHERE id=$1", [req.params.id]);
        res.redirect('/admin/banners?success=Banner deleted');
    } catch (err) { res.redirect('/admin/banners?error=' + encodeURIComponent(err.message)); }
});

router.get('/collaborations', isAdmin, async (req, res) => {
    try {
        const logos = await pool.query("SELECT * FROM collaborations ORDER BY sort_order ASC, id ASC");
        res.render('admin/collaborations', {
            title: 'Collaborations', user: req.session.user,
            logos: logos.rows,
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.post('/collaborations/add', isAdmin, async (req, res) => {
    try {
        const { name, logo_url, website, sort_order, is_active } = req.body;
        if (!name || !logo_url) return res.redirect('/admin/collaborations?error=Name and logo URL are required');
        await pool.query(
            "INSERT INTO collaborations (name, logo_url, website, sort_order, is_active) VALUES ($1,$2,$3,$4,$5)",
            [name, logo_url, website || null, Number(sort_order || 0), is_active === 'on' || is_active === 'true']
        );
        res.redirect('/admin/collaborations?success=Logo added');
    } catch (err) { res.redirect('/admin/collaborations?error=' + encodeURIComponent(err.message)); }
});

router.post('/collaborations/toggle/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE collaborations SET is_active = NOT is_active WHERE id = $1", [req.params.id]);
        res.redirect('/admin/collaborations?success=Logo status updated');
    } catch (err) { res.redirect('/admin/collaborations?error=' + encodeURIComponent(err.message)); }
});

router.post('/collaborations/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM collaborations WHERE id = $1", [req.params.id]);
        res.redirect('/admin/collaborations?success=Logo removed');
    } catch (err) { res.redirect('/admin/collaborations?error=' + encodeURIComponent(err.message)); }
});

// ==========================================
// SETTINGS (COMPREHENSIVE)
// ==========================================
router.get('/settings', isAdmin, async (req, res) => {
    try {
        const [result, adminUsers, staffUsers] = await Promise.all([
            pool.query("SELECT * FROM store_settings"),
            pool.query("SELECT id, full_name, email FROM users WHERE role = 'admin' ORDER BY created_at ASC"),
            pool.query("SELECT id, full_name, email FROM users WHERE role = 'staff' ORDER BY created_at ASC")
        ]);
        const settings = {};
        result.rows.forEach(r => settings[r.setting_key] = r.setting_value);

        // Ensure default structures exist if table is sparse
        const defaults = {
            store_name: 'Shanmukha Stores',
            store_tagline: 'Authenticity in Every Piece',
            currency_symbol: '₹',
            marquee_active: 'false'
        };
        const finalSettings = { ...defaults, ...settings };

        res.render('admin/settings', {
            title: 'Global Configuration',
            user: req.session.user,
            settings: finalSettings,
            admins: adminUsers.rows,
            staff: staffUsers.rows,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) { res.redirect('/admin/dashboard?error=Failed to load settings'); }
});

router.post('/settings/reset-password', isAdmin, async (req, res) => {
    try {
        const { target_user_id, new_password, confirm_password } = req.body;
        if (!target_user_id) return res.redirect('/admin/settings?error=Please select a user');
        if (!new_password || new_password.length < 6) {
            return res.redirect('/admin/settings?error=Password must be at least 6 characters');
        }
        if (new_password !== confirm_password) {
            return res.redirect('/admin/settings?error=Passwords do not match');
        }

        const target = await pool.query("SELECT id, role, email FROM users WHERE id = $1", [target_user_id]);
        if (!target.rows.length) return res.redirect('/admin/settings?error=User not found');
        if (!['admin', 'staff'].includes(target.rows[0].role)) {
            return res.redirect('/admin/settings?error=Only admin or staff passwords can be changed here');
        }

        const bcrypt = require('bcrypt');
        const hashed = await bcrypt.hash(new_password, 12);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, target_user_id]);
        await logActivity(req.session.user.id, "Reset Account Password", { userId: target_user_id });

        return res.redirect('/admin/settings?success=Password updated successfully');
    } catch (err) {
        return res.redirect('/admin/settings?error=' + encodeURIComponent(err.message));
    }
});

router.post('/settings', isAdmin, async (req, res) => {
    try {
        const settingsData = { ...req.body };
        delete settingsData._csrf; // If session CSRF is in body

        // Special handling for checkboxes which might be missing if unchecked
        const booleanFields = ['marquee_active', 'maintenance_mode'];
        booleanFields.forEach(field => {
            settingsData[field] = settingsData[field] === 'true' || settingsData[field] === 'on' ? 'true' : 'false';
        });

        if (!settingsData.marquee_speed) settingsData.marquee_speed = '30';

        const queries = Object.entries(settingsData).map(([key, value]) => {
            return pool.query(
                "INSERT INTO store_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value",
                [key, String(value)]
            );
        });

        await Promise.all(queries);

        await logActivity(req.session.user.id, "Updated Settings", { keys: Object.keys(settingsData) });
        res.redirect('/admin/settings?success=Configuration updated successfully');
    } catch (err) { res.redirect('/admin/settings?error=' + encodeURIComponent(err.message)); }
});

router.get('/returns', isAdmin, async (req, res) => {
    try {
        const returnsResult = await pool.query(
            `SELECT r.*, 
                    o.id AS order_number, o.status AS order_status, o.total_amount,
                    u.full_name AS user_name, u.email AS user_email
             FROM returns r
             JOIN orders o ON o.id = r.order_id
             JOIN users u ON u.id = r.user_id
             ORDER BY r.created_at DESC`
        );

        res.render('admin/returns', {
            title: 'Returns',
            user: req.session.user,
            returns: returnsResult.rows,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        res.redirect('/admin/dashboard?error=' + encodeURIComponent(err.message));
    }
});

router.post('/returns/status/:id', isAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const existingReturn = await pool.query("SELECT status FROM returns WHERE id = $1", [req.params.id]);
        if (existingReturn.rows.length && (existingReturn.rows[0].status === 'Refunded' || existingReturn.rows[0].status === 'Rejected')) {
            return res.redirect('/admin/returns?error=Cannot update a terminal return status');
        }
        await pool.query("UPDATE returns SET status = $1 WHERE id = $2", [status, req.params.id]);
        res.redirect('/admin/returns?success=' + encodeURIComponent('Return status updated to ' + status));
    } catch (err) { res.redirect('/admin/returns?error=' + encodeURIComponent(err.message)); }
});

// ==========================================
// COLLECTIONS
// ==========================================
router.get('/collections', isAdmin, async (req, res) => {
    try {
        const collections = await pool.query("SELECT * FROM collections ORDER BY id DESC");
        const allProducts = await pool.query("SELECT id, name FROM products ORDER BY name ASC").then(res => res.rows);

        for (let coll of collections.rows) {
            const productIds = await pool.query("SELECT product_id FROM collection_products WHERE collection_id = $1", [coll.id]).then(r => r.rows.map(row => row.product_id));
            coll.productIds = productIds;
        }

        res.render('admin/collections', {
            title: 'Collections', user: req.session.user,
            collections: collections.rows,
            allProducts,
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) {
        console.error(err);
        res.redirect('/admin/dashboard?error=' + encodeURIComponent('Failed to load collections'));
    }
});

router.post('/collections/add', isAdmin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const { name, description, image, is_active } = req.body;

        const result = await client.query(
            "INSERT INTO collections (name, description, image, is_active) VALUES ($1, $2, $3, $4) RETURNING id",
            [name, description, image || null, is_active === 'on']
        );

        const newCollectionId = result.rows[0].id;
        let product_ids_arr = [];
        if (req.body.product_ids) {
            product_ids_arr = Array.isArray(req.body.product_ids) ? req.body.product_ids : [req.body.product_ids];
        }

        if (product_ids_arr.length > 0) {
            for (let pid of product_ids_arr) {
                await client.query("INSERT INTO collection_products (collection_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [newCollectionId, parseInt(pid)]);
            }
        }

        await client.query('COMMIT');
        res.redirect('/admin/collections?success=Collection created successfully');
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        res.redirect('/admin/collections?error=' + encodeURIComponent(err.message));
    } finally {
        if (client) client.release();
    }
});

router.post('/collections/edit/:id', isAdmin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const { name, description, image } = req.body;
        const collId = parseInt(req.params.id);

        await client.query(
            "UPDATE collections SET name=$1, description=$2, image=$3 WHERE id=$4",
            [name, description, image || null, collId]
        );

        await client.query("DELETE FROM collection_products WHERE collection_id=$1", [collId]);

        let product_ids_arr = [];
        if (req.body.product_ids) {
            product_ids_arr = Array.isArray(req.body.product_ids) ? req.body.product_ids : [req.body.product_ids];
        }

        if (product_ids_arr.length > 0) {
            for (let pid of product_ids_arr) {
                await client.query("INSERT INTO collection_products (collection_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [collId, parseInt(pid)]);
            }
        }

        await client.query('COMMIT');
        res.redirect('/admin/collections?success=Collection updated successfully');
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        res.redirect('/admin/collections?error=' + encodeURIComponent(err.message));
    } finally {
        if (client) client.release();
    }
});

router.post('/collections/toggle/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE collections SET is_active = NOT is_active WHERE id=$1", [req.params.id]);
        res.redirect('/admin/collections?success=Collection visibility toggled');
    } catch (err) { res.redirect('/admin/collections?error=' + encodeURIComponent(err.message)); }
});

router.post('/collections/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM collections WHERE id=$1", [req.params.id]);
        res.redirect('/admin/collections?success=Collection deleted');
    } catch (err) { res.redirect('/admin/collections?error=' + encodeURIComponent(err.message)); }
});

// ==========================================
// POPUP ADS
// ==========================================
router.get('/popup-ads', isAdmin, async (req, res) => {
    try {
        const popupAds = await pool.query("SELECT * FROM popup_ads ORDER BY id DESC");

        res.render('admin/popup-ads', {
            title: 'Popup Ads', user: req.session.user,
            popupAds: popupAds.rows,
            error: req.query.error || null, success: req.query.success || null
        });
    } catch (err) {
        console.error(err);
        res.redirect('/admin/dashboard?error=' + encodeURIComponent('Failed to load popup ads'));
    }
});

const popupUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'popups');

router.post('/popup-ads/add', isAdmin, productImageUpload.single('image_file'), async (req, res) => {
    try {
        const { title, target_url, is_active } = req.body;
        let image_url = req.body.image_url;

        if (req.file) {
            const baseName = `popup-${Date.now()}`;
            image_url = await processMediaFile(req.file, popupUploadDir, baseName);
        }

        if (is_active === 'on') {
            await pool.query("UPDATE popup_ads SET is_active = false");
        }

        await pool.query(
            "INSERT INTO popup_ads (title, image_url, target_url, is_active) VALUES ($1, $2, $3, $4)",
            [title, image_url, target_url || null, is_active === 'on']
        );
        res.redirect('/admin/popup-ads?success=Popup Ad added successfully');
    } catch (err) { res.redirect('/admin/popup-ads?error=' + encodeURIComponent(err.message)); }
});

router.post('/popup-ads/edit/:id', isAdmin, productImageUpload.single('image_file'), async (req, res) => {
    try {
        const { title, target_url } = req.body;
        let image_url = req.body.image_url;

        if (req.file) {
            const baseName = `popup-${Date.now()}`;
            image_url = await processMediaFile(req.file, popupUploadDir, baseName);
        }

        await pool.query(
            "UPDATE popup_ads SET title=$1, image_url=$2, target_url=$3 WHERE id=$4",
            [title, image_url, target_url || null, req.params.id]
        );
        res.redirect('/admin/popup-ads?success=Popup Ad updated successfully');
    } catch (err) { res.redirect('/admin/popup-ads?error=' + encodeURIComponent(err.message)); }
});

router.post('/popup-ads/toggle/:id', isAdmin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const ad = await client.query("SELECT is_active FROM popup_ads WHERE id=$1", [req.params.id]);
        const currentlyActive = ad.rows[0].is_active;

        if (!currentlyActive) {
            await client.query("UPDATE popup_ads SET is_active = false");
        }

        await client.query("UPDATE popup_ads SET is_active = $1 WHERE id=$2", [!currentlyActive, req.params.id]);

        await client.query('COMMIT');
        res.redirect('/admin/popup-ads?success=Popup Ad visibility toggled');
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        res.redirect('/admin/popup-ads?error=' + encodeURIComponent(err.message));
    } finally {
        if (client) client.release();
    }
});

router.post('/popup-ads/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM popup_ads WHERE id=$1", [req.params.id]);
        res.redirect('/admin/popup-ads?success=Popup Ad deleted');
    } catch (err) { res.redirect('/admin/popup-ads?error=' + encodeURIComponent(err.message)); }
});



module.exports = router;
