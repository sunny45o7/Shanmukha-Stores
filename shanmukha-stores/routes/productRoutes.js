const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { getProductWeightOptions } = require("../utils/weightUtils");
const { normalizeCouponCode, validateCouponForUser, calculateCouponDiscount } = require("../utils/couponService");

const PRODUCTS_PER_PAGE = 12;

const effectivePriceSQL = `
  CASE
    WHEN p.offer_active = true AND COALESCE(p.offer_percent, 0) > 0
    THEN ROUND((p.price * (1 - COALESCE(p.offer_percent, 0) / 100.0))::numeric, 2)
    ELSE p.price
  END AS effective_price
`;

const normalizeCouponIds = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
  }
  if (typeof value === "string") {
    return value
      .replace(/[{}]/g, "")
      .split(",")
      .map((v) => Number(String(v).trim()))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  return [];
};

// ============================================================
// GET HOME PAGE
// ============================================================
router.get("/", async (req, res, next) => {
  try {
    const [productsResult, categoriesResult, bannersResult, settingsResult, collaborationsResult] = await Promise.all([
      pool.query(
        `SELECT p.*, c.name AS category_name, ${effectivePriceSQL},
         COALESCE(AVG(r.rating), 0)::numeric(3,1) AS average_rating,
         COUNT(r.id)::int AS review_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN reviews r ON p.id = r.product_id AND r.is_approved = true
         WHERE COALESCE(p.is_enabled, true) = true
         GROUP BY p.id, c.name
         ORDER BY p.created_at DESC
         LIMIT 5`
      ),
      pool.query("SELECT * FROM categories ORDER BY name"),
      pool.query("SELECT * FROM banners WHERE is_active = true ORDER BY position ASC"),
      pool.query("SELECT * FROM store_settings"),
      pool.query("SELECT * FROM collaborations WHERE is_active = true ORDER BY sort_order ASC, id ASC"),
    ]);

    const settings = {};
    settingsResult.rows.forEach((r) => {
      settings[r.setting_key] = r.setting_value;
    });

    res.render("index", {
      title: "Shanmukha Stores",
      products: productsResult.rows,
      categories: categoriesResult.rows,
      banners: bannersResult.rows,
      collaborations: collaborationsResult.rows,
      settings,
    });
  } catch (err) {
    console.error("Home Route Error:", err.message);
    next(err);
  }
});

// ============================================================
// GET ALL PRODUCTS
// ============================================================
router.get("/products", async (req, res, next) => {
  try {
    const { search, category, sort, page } = req.query;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * PRODUCTS_PER_PAGE;

    const whereClauses = ["COALESCE(p.is_enabled, true) = true"];
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      whereClauses.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }
    if (category && !isNaN(parseInt(category, 10))) {
      params.push(parseInt(category, 10));
      whereClauses.push(`p.category_id = $${params.length}`);
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    let orderSQL = "ORDER BY p.created_at DESC";
    if (sort === "price_asc") orderSQL = "ORDER BY p.price ASC";
    else if (sort === "price_desc") orderSQL = "ORDER BY p.price DESC";
    else if (sort === "name_asc") orderSQL = "ORDER BY p.name ASC";

    const countResult = await pool.query(`SELECT COUNT(*) FROM products p ${whereSQL}`, params);
    const totalCount = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalCount / PRODUCTS_PER_PAGE);

    const productsResult = await pool.query(
      `SELECT p.*, c.name AS category_name, ${effectivePriceSQL},
       COALESCE(AVG(r.rating), 0)::numeric(3,1) AS average_rating,
       COUNT(r.id)::int AS review_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN reviews r ON p.id = r.product_id AND r.is_approved = true
       ${whereSQL}
       GROUP BY p.id, c.name
       ${orderSQL}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, PRODUCTS_PER_PAGE, offset]
    );

    const categoriesResult = await pool.query("SELECT * FROM categories ORDER BY name");

    res.render("products", {
      title: "All Products - Shanmukha Stores",
      products: productsResult.rows,
      categories: categoriesResult.rows,
      search: search || "",
      selectedCategory: category || "",
      sort: sort || "",
      currentPage,
      totalPages,
      totalCount,
    });
  } catch (err) {
    console.error("Products Route Error:", err.message);
    next(err);
  }
});

// ============================================================
// GET SINGLE PRODUCT
// ============================================================
router.get("/products/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const couponCode = normalizeCouponCode(req.query.coupon);

    const [productResult, imagesResult, relatedResult, reviewsResult] = await Promise.all([
      pool.query(
        `SELECT p.*, c.name AS category_name, ${effectivePriceSQL},
         COALESCE(AVG(r.rating), 0)::numeric(3,1) AS average_rating,
         COUNT(r.id)::int AS review_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN reviews r ON p.id = r.product_id AND r.is_approved = true
         WHERE p.id = $1 AND COALESCE(p.is_enabled, true) = true
         GROUP BY p.id, c.name`,
        [id]
      ),
      pool.query(
        "SELECT * FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, created_at ASC",
        [id]
      ),
      pool.query(
        `SELECT p.*, ${effectivePriceSQL},
         COALESCE(AVG(r.rating), 0)::numeric(3,1) AS average_rating,
         COUNT(r.id)::int AS review_count
         FROM products p
         LEFT JOIN reviews r ON p.id = r.product_id AND r.is_approved = true
         WHERE p.category_id = (SELECT category_id FROM products WHERE id = $1)
           AND p.id != $1
           AND COALESCE(p.is_enabled, true) = true
         GROUP BY p.id
         LIMIT 4`,
        [id]
      ),
      pool.query(
        `SELECT r.*, u.full_name AS user_name
         FROM reviews r
         JOIN users u ON u.id = r.user_id
         WHERE r.product_id = $1 AND r.is_approved = true
         ORDER BY r.created_at DESC`,
        [id]
      ),
    ]);

    if (productResult.rows.length === 0) {
      return res.status(404).render("errors/404", { title: "Product Not Found", user: res.locals.user });
    }

    const product = productResult.rows[0];
    const weightOptions = getProductWeightOptions(product);
    const defaultWeight = weightOptions.includes("1kg")
      ? "1kg"
      : (weightOptions[0] || null);
    const basePrice = Number(product.price);
    const offerPercent = product.offer_active ? Number(product.offer_percent || 0) : 0;
    const offerAmount = offerPercent > 0 ? (basePrice * offerPercent) / 100 : 0;
    const offerPrice = Math.max(basePrice - offerAmount, 0);

    let couponError = null;
    let appliedCoupon = null;
    let couponDiscountAmount = 0;

    if (couponCode) {
      const couponState = await validateCouponForUser({
        client: pool,
        code: couponCode,
        subtotal: offerPrice,
        userId: req.session.user ? req.session.user.id : null,
        cartItems: [{
          product_id: product.id,
          category_id: product.category_id,
          subtotal: offerPrice,
          quantity: 1,
          price: offerPrice
        }]
      });
      if (couponState.ok) {
        appliedCoupon = couponState.coupon;
        couponDiscountAmount = Number(couponState.discount || 0);
      } else {
        couponError = couponState.error;
      }
    }

    const couponsResult = await pool.query(
      `SELECT id, code, description, discount_type, discount_value, min_order_amount, max_discount,
              usage_limit, used_count, applicable_product_ids, applicable_category_ids
       FROM coupons
       WHERE is_active = true
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY created_at DESC
       LIMIT 50`
    );

    let userUsedMap = new Map();
    if (req.session.user && couponsResult.rows.length > 0) {
      const couponIds = couponsResult.rows
        .map((c) => Number(c.id))
        .filter((v) => Number.isInteger(v) && v > 0);
      if (couponIds.length > 0) {
        const usageResult = await pool.query(
          `SELECT coupon_id, COUNT(*)::int AS used_count
           FROM coupon_usages
           WHERE user_id = $1
             AND coupon_id = ANY($2::int[])
           GROUP BY coupon_id`,
          [req.session.user.id, couponIds]
        );
        userUsedMap = new Map(usageResult.rows.map((r) => [Number(r.coupon_id), Number(r.used_count || 0)]));
      }
    }

    const productId = Number(product.id);
    const categoryId = Number(product.category_id || 0);
    const availableCoupons = couponsResult.rows
      .filter((coupon) => {
        const productRestrictions = normalizeCouponIds(coupon.applicable_product_ids);
        const categoryRestrictions = normalizeCouponIds(coupon.applicable_category_ids);
        const hasRestrictions = productRestrictions.length > 0 || categoryRestrictions.length > 0;
        if (hasRestrictions) {
          const matchesProduct = productRestrictions.includes(productId);
          const matchesCategory = categoryRestrictions.includes(categoryId);
          if (!matchesProduct && !matchesCategory) return false;
        }

        const minOrder = Number(coupon.min_order_amount || 0);
        if (offerPrice < minOrder) return false;

        const usageLimit = Number(coupon.usage_limit || 0);
        const usedCount = Number(coupon.used_count || 0);
        if (usageLimit > 0 && usedCount >= usageLimit) return false;

        if (req.session.user) {
          const userUsed = Number(userUsedMap.get(Number(coupon.id)) || 0);
          if (userUsed >= 1) return false;
        }

        const previewDiscount = calculateCouponDiscount({ subtotal: offerPrice, coupon });
        return previewDiscount > 0;
      })
      .map((coupon) => {
        const previewDiscount = calculateCouponDiscount({ subtotal: offerPrice, coupon });
        const value = Number(coupon.discount_value || 0);
        const baseSummary = coupon.discount_type === "percent"
          ? `${value.toFixed(2).replace(/\.00$/, "")}% OFF`
          : `Rs ${value.toLocaleString("en-IN")} OFF`;
        const minOrder = Number(coupon.min_order_amount || 0);
        const minOrderLabel = minOrder > 0 ? ` | Min Rs ${minOrder.toLocaleString("en-IN")}` : "";
        const saveLabel = `Save Rs ${previewDiscount.toLocaleString("en-IN")}`;
        return {
          code: coupon.code,
          summary: `${baseSummary}${minOrderLabel} | ${saveLabel}`,
          description: coupon.description || ""
        };
      });

    const finalPrice = Math.max(offerPrice - couponDiscountAmount, 0);

    let inWishlist = false;
    if (req.session.user) {
      const w = await pool.query(
        "SELECT id FROM wishlist WHERE user_id = $1 AND product_id = $2",
        [req.session.user.id, id]
      );
      inWishlist = w.rows.length > 0;
    }

    res.render("product", {
      title: product.name,
      product,
      images: imagesResult.rows,
      relatedProducts: relatedResult.rows,
      reviews: reviewsResult.rows,
      inWishlist,
      weightOptions,
      defaultWeight,
      couponCode,
      couponError,
      appliedCoupon,
      availableCoupons,
      pricing: {
        basePrice,
        offerPercent,
        offerPrice,
        couponDiscountAmount,
        finalPrice,
      },
    });
  } catch (err) {
    console.error("Product detail error:", err.message);
    next(err);
  }
});

// ============================================================
// GET COLLECTIONS
// ============================================================
router.get("/collections", async (req, res, next) => {
  try {
    const [collectionsResult, categoriesResult] = await Promise.all([
      pool.query("SELECT * FROM collections WHERE is_active = true ORDER BY id DESC"),
      pool.query("SELECT * FROM categories ORDER BY name ASC")
    ]);
    res.render("collections", {
      title: "Our Collections",
      user: res.locals.user,
      collections: collectionsResult.rows,
      categories: categoriesResult.rows
    });
  } catch (err) {
    console.error("Collections route error:", err.message);
    next(err);
  }
});

router.get("/collections/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { sort } = req.query;

    let orderBy = "ORDER BY p.id DESC";
    if (sort === "price-asc") orderBy = "ORDER BY effective_price ASC";
    else if (sort === "price-desc") orderBy = "ORDER BY effective_price DESC";
    else if (sort === "rating") orderBy = "ORDER BY average_rating DESC NULLS LAST";

    const [collectionResult, categoriesResult, productsResult] = await Promise.all([
      pool.query("SELECT * FROM collections WHERE id = $1 AND is_active = true", [id]),
      pool.query("SELECT * FROM categories ORDER BY name ASC"),
      pool.query(`
        SELECT p.*, c.name AS category_name, ${effectivePriceSQL},
               COALESCE(AVG(r.rating), 0)::numeric(3,1) AS average_rating,
               COUNT(r.id)::int AS review_count
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN reviews r ON r.product_id = p.id AND r.is_approved = true
        JOIN collection_products cp ON cp.product_id = p.id
        WHERE cp.collection_id = $1 AND COALESCE(p.is_enabled, true) = true
        GROUP BY p.id, c.name
        ${orderBy}
      `, [id])
    ]);

    if (collectionResult.rows.length === 0) {
      return res.status(404).render("errors/404", { title: "Collection Not Found", user: res.locals.user });
    }

    res.render("collection-products", {
      title: collectionResult.rows[0].name,
      user: res.locals.user,
      collection: collectionResult.rows[0],
      products: productsResult.rows,
      categories: categoriesResult.rows,
      sort: sort || ""
    });
  } catch (err) {
    console.error("Collection products route error:", err.message);
    next(err);
  }
});

module.exports = router;
