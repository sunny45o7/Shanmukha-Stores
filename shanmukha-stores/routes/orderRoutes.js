const express = require("express");
const pool = require("../config/db");
const { sendOrderConfirmationEmail } = require("../utils/mailer");
const { normalizeCouponCode, validateCouponForUser } = require("../utils/couponService");
const { parseWeightToKg } = require("../utils/weightUtils");

const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
};

// ============================================================
// CITY MINIMUMS CONFIG
// ============================================================
const CITY_RULES = {
  vijayawada: { minAmount: 200, minItems: 1 },
  tadepalli: { minAmount: 590, minItems: 3 },
  kanuru: { minAmount: 590, minItems: 3 },
  penamaluru: { minAmount: 590, minItems: 3 },
  poranki: { minAmount: 590, minItems: 3 },
  default: { minAmount: 1500, minItems: 5 },
};

const getCityRules = (city) => {
  const key = String(city || "").toLowerCase().trim();
  if (!key) return CITY_RULES.default;
  return CITY_RULES[key] || CITY_RULES.default;
};

const getDeliveryLabel = (order) => {
  if (!order || !order.estimated_delivery_at) return null;
  const eta = new Date(order.estimated_delivery_at);
  if (Number.isNaN(eta.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const etaDay = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate()).getTime();
  const diffDays = Math.round((etaDay - today) / (24 * 60 * 60 * 1000));

  const timeStr = eta.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Arriving today by ${timeStr}`;
  if (diffDays === 1) return `Arriving tomorrow by ${timeStr}`;
  if (diffDays > 1) return `Expected by ${eta.toLocaleDateString("en-IN")} ${timeStr}`;
  return `Delivery date was ${eta.toLocaleDateString("en-IN")} ${timeStr}`;
};

const RETURN_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const isCancelableStatus = (status) => {
  const s = String(status || "").trim();
  return s !== "Delivered" && s !== "Cancelled";
};

const getDeliveredAtDate = (order) => {
  const raw = (order && (order.delivered_at || order.created_at)) || null;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const isReturnWindowOpen = (order) => {
  if (!order || String(order.status || "") !== "Delivered") return false;
  const deliveredAt = getDeliveredAtDate(order);
  if (!deliveredAt) return false;
  return (Date.now() - deliveredAt.getTime()) <= RETURN_WINDOW_MS;
};

const getReturnWindowEndsAt = (order) => {
  const deliveredAt = getDeliveredAtDate(order);
  if (!deliveredAt) return null;
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_MS);
};

const notifyOps = async ({ title, message, type = "order" }) => {
  const opsUsers = await pool.query(
    "SELECT id FROM users WHERE role IN ('admin', 'staff') AND COALESCE(is_blocked, false) = false"
  );
  for (const u of opsUsers.rows) {
    await pool.query(
      "INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)",
      [u.id, title, message, type]
    );
  }
};

// ============================================================
// GET CHECKOUT PAGE
// ============================================================
router.get("/checkout", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const cartResult = await pool.query("SELECT * FROM carts WHERE user_id = $1", [userId]);

    if (cartResult.rows.length === 0) {
      return res.redirect("/cart?error=Your cart is empty");
    }

    const cart = cartResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT ci.id, ci.quantity, ci.selected_weight, p.id AS product_id, p.category_id, p.name,
              p.price AS base_price,
              CASE
                WHEN p.offer_active = true AND COALESCE(p.offer_percent, 0) > 0
                THEN ROUND((p.price * (1 - COALESCE(p.offer_percent, 0) / 100.0))::numeric, 2)
                ELSE p.price
              END AS price,
              p.image, p.stock, p.price_type
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
         AND COALESCE(p.is_enabled, true) = true`,
      [cart.id]
    );

    const cartItems = itemsResult.rows.map(item => {
      let originalUnitPrice = Number(item.base_price);
      let finalPrice = Number(item.price);
      if (item.price_type === 'kg' && item.selected_weight) {
        const multiplier = parseWeightToKg(item.selected_weight) || 1;
        originalUnitPrice = originalUnitPrice * multiplier;
        finalPrice = finalPrice * multiplier;
      }
      return {
        ...item,
        originalUnitPrice,
        finalPrice,
        originalSubtotal: originalUnitPrice * item.quantity,
        subtotal: finalPrice * item.quantity
      };
    });

    if (itemsResult.rows.length === 0) {
      return res.redirect("/cart?error=Your cart is empty");
    }

    // Stock check - warn about any out-of-stock items
    const stockWarnings = itemsResult.rows
      .filter((item) => item.quantity > item.stock)
      .map((item) => `"${item.name}" only has ${item.stock} units left`);

    const addresses = await pool.query(
      "SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC",
      [userId]
    );

    const originalSubtotal = cartItems.reduce((sum, i) => sum + i.originalSubtotal, 0);
    const subtotal = cartItems.reduce((sum, i) => sum + i.subtotal, 0);
    const offerDiscount = Math.max(originalSubtotal - subtotal, 0);
    const couponCode = normalizeCouponCode(req.session.appliedCouponCode);
    let appliedCoupon = null;
    let couponDiscount = 0;
    let couponError = null;
    const couponValidationItems = cartItems.map((item) => ({
      product_id: item.product_id,
      category_id: item.category_id,
      subtotal: Number(item.subtotal || 0),
      quantity: Number(item.quantity || 0),
      price: Number(item.finalPrice || 0)
    }));

    if (couponCode) {
      const couponState = await validateCouponForUser({
        client: pool,
        code: couponCode,
        subtotal,
        userId,
        cartItems: couponValidationItems
      });
      if (!couponState.ok) {
        req.session.appliedCouponCode = null;
        couponError = couponState.error;
      } else {
        appliedCoupon = couponState.coupon;
        couponDiscount = couponState.discount;
      }
    }

    const total = Math.max(subtotal - couponDiscount, 0);

    res.render("checkout", {
      title: "Checkout",
      cartItems,
      originalSubtotal,
      offerDiscount,
      subtotal,
      couponDiscount,
      appliedCoupon,
      couponError,
      total,
      totalItems: cartItems.reduce((sum, i) => sum + i.quantity, 0),
      addresses: addresses.rows,
      stockWarnings,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    console.error("Checkout GET error:", err);
    next(err);
  }
});

// ============================================================
// GET SCAN AND PAY DEDICATED PAGE
// ============================================================
router.get('/scan-pay', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const cartResult = await pool.query('SELECT * FROM carts WHERE user_id = $1', [userId]);
    if (cartResult.rows.length === 0) {
      return res.redirect('/cart?error=Your cart is empty');
    }

    const cart = cartResult.rows[0];
    const itemsResult = await pool.query(
      `SELECT ci.id, ci.quantity, ci.selected_weight, p.id AS product_id, p.category_id, p.name,
              p.price AS base_price,
              CASE
                WHEN p.offer_active = true AND COALESCE(p.offer_percent, 0) > 0
                THEN ROUND((p.price * (1 - COALESCE(p.offer_percent, 0) / 100.0))::numeric, 2)
                ELSE p.price
              END AS price,
              p.image, p.stock, p.price_type
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
         AND COALESCE(p.is_enabled, true) = true`,
      [cart.id]
    );

    if (itemsResult.rows.length === 0) {
      return res.redirect('/cart?error=Your cart is empty');
    }

    const cartItems = itemsResult.rows.map(item => {
      let originalUnitPrice = Number(item.base_price);
      let finalPrice = Number(item.price);
      if (item.price_type === 'kg' && item.selected_weight) {
        const multiplier = parseWeightToKg(item.selected_weight) || 1;
        originalUnitPrice = originalUnitPrice * multiplier;
        finalPrice = finalPrice * multiplier;
      }
      return {
        ...item,
        originalUnitPrice,
        finalPrice,
        originalSubtotal: originalUnitPrice * item.quantity,
        subtotal: finalPrice * item.quantity
      };
    });

    const originalSubtotal = cartItems.reduce((sum, i) => sum + i.originalSubtotal, 0);
    const subtotal = cartItems.reduce((sum, i) => sum + i.subtotal, 0);
    const offerDiscount = Math.max(originalSubtotal - subtotal, 0);
    const couponCode = normalizeCouponCode(req.session.appliedCouponCode);
    let appliedCoupon = null;
    let couponDiscount = 0;

    if (couponCode) {
      const couponState = await validateCouponForUser({
        client: pool,
        code: couponCode,
        subtotal,
        userId,
        cartItems: cartItems.map(item => ({ product_id: item.product_id, category_id: item.category_id, subtotal: Number(item.subtotal || 0), quantity: Number(item.quantity || 0), price: Number(item.finalPrice || 0) }))
      });
      if (!couponState.ok) {
        req.session.appliedCouponCode = null;
      } else {
        appliedCoupon = couponState.coupon;
        couponDiscount = couponState.discount;
      }
    }

    const total = Math.max(subtotal - couponDiscount, 0);

    const addresses = await pool.query(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [userId]
    );

    res.render('scan-pay', {
      title: 'Scan and Pay',
      cartItems,
      originalSubtotal,
      offerDiscount,
      subtotal,
      couponDiscount,
      appliedCoupon,
      total,
      totalItems: cartItems.reduce((sum, i) => sum + i.quantity, 0),
      addresses: addresses.rows,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    console.error('Scan Pay GET error:', err);
    next(err);
  }
});

// ============================================================
// POST PLACE ORDER VIA WHATSAPP (JSON API for AJAX)
// ============================================================
router.post("/place-whatsapp", requireAuth, async (req, res) => {
  const client = await pool.connect();
  let transactionCommitted = false;
  let placedOrderId = null;

  try {
    const userId = req.session.user.id;
    const { address_id, notes } = req.body;
    const normalizedPaymentMethod = "whatsapp";
    const newAddressPayload = req.body.new_address || {
      full_name: req.body.full_name,
      phone: req.body.phone,
      address_line: req.body.address_line,
      city: req.body.city,
      state: req.body.state,
      pincode: req.body.pincode,
    };

    await client.query("BEGIN");

    const cartResult = await client.query("SELECT * FROM carts WHERE user_id = $1", [userId]);
    if (cartResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: "Your cart is empty" });
    }

    const cart = cartResult.rows[0];
    const itemsResult = await client.query(
      `SELECT ci.product_id, ci.quantity, ci.selected_weight, p.category_id,
              CASE
                WHEN p.offer_active = true AND COALESCE(p.offer_percent, 0) > 0
                THEN ROUND((p.price * (1 - COALESCE(p.offer_percent, 0) / 100.0))::numeric, 2)
                ELSE p.price
              END AS price,
              p.name, p.stock, p.price_type
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
         AND COALESCE(p.is_enabled, true) = true`,
      [cart.id]
    );

    if (itemsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: "Your cart is empty" });
    }

    for (const item of itemsResult.rows) {
      if (item.quantity > item.stock) {
        await client.query("ROLLBACK");
        return res.json({ ok: false, error: `"${item.name}" only has ${item.stock} units left.` });
      }
    }

    let subtotalAmount = 0;
    let totalItems = 0;
    itemsResult.rows.forEach((item) => {
      let price = Number(item.price);
      if (item.price_type === 'kg' && item.selected_weight) {
        price = price * (parseWeightToKg(item.selected_weight) || 1);
      }
      subtotalAmount += price * item.quantity;
      totalItems += item.quantity;
    });

    const couponCode = normalizeCouponCode(req.session.appliedCouponCode);
    let appliedCoupon = null;
    let couponDiscount = 0;
    let totalAmount = subtotalAmount;
    const couponValidationItems = itemsResult.rows.map((item) => {
      let effectivePrice = Number(item.price || 0);
      if (item.price_type === "kg" && item.selected_weight) {
        effectivePrice = effectivePrice * (parseWeightToKg(item.selected_weight) || 1);
      }
      return { product_id: item.product_id, category_id: item.category_id, subtotal: effectivePrice * Number(item.quantity || 0), quantity: Number(item.quantity || 0), price: effectivePrice };
    });

    if (couponCode) {
      try {
        const couponState = await validateCouponForUser({ client, code: couponCode, subtotal: subtotalAmount, userId, cartItems: couponValidationItems, lock: true });
        if (couponState.ok) {
          appliedCoupon = couponState.coupon;
          couponDiscount = couponState.discount;
          totalAmount = Math.max(subtotalAmount - couponDiscount, 0);
        } else {
          req.session.appliedCouponCode = null;
        }
      } catch (e) {
        req.session.appliedCouponCode = null;
      }
    }

    let finalAddressId = null;
    let addressSnapshot = "";
    let deliveryCity = "";

    if (address_id && address_id !== "new") {
      const addrResult = await client.query("SELECT * FROM addresses WHERE id = $1 AND user_id = $2", [address_id, userId]);
      if (addrResult.rows.length === 0) { await client.query("ROLLBACK"); return res.json({ ok: false, error: "Invalid address selected" }); }
      const addr = addrResult.rows[0];
      if (!addr.phone || !addr.full_name || !addr.address_line || !addr.city || !addr.state || !addr.pincode) {
        await client.query("ROLLBACK"); return res.json({ ok: false, error: "Selected address is incomplete." });
      }
      finalAddressId = addr.id;
      addressSnapshot = `${addr.full_name}, ${addr.address_line}, ${addr.city}, ${addr.state} - ${addr.pincode}`;
      deliveryCity = String(addr.city || "").trim();
      const rules = getCityRules(addr.city);
      if (subtotalAmount < rules.minAmount || totalItems < rules.minItems) {
        await client.query("ROLLBACK");
        return res.json({ ok: false, error: `Minimum order for ${addr.city} is Rs ${rules.minAmount} and ${rules.minItems} item(s).` });
      }
    } else if (newAddressPayload && newAddressPayload.city) {
      const { full_name, phone, address_line, city, state, pincode } = newAddressPayload;
      const phoneClean = String(phone || "").replace(/\s+/g, "");
      if (!full_name || !address_line || !city || !state || !pincode || !phoneClean) {
        await client.query("ROLLBACK"); return res.json({ ok: false, error: "Please fill in all address fields including mobile number" });
      }
      if (!/^[0-9+\-()]{8,20}$/.test(phoneClean)) {
        await client.query("ROLLBACK"); return res.json({ ok: false, error: "Please enter a valid mobile number" });
      }
      const newAddrResult = await client.query(
        `INSERT INTO addresses (user_id, full_name, phone, address_line, city, state, pincode) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [userId, full_name, phone || null, address_line, city, state, pincode]
      );
      const addr = newAddrResult.rows[0];
      finalAddressId = addr.id;
      addressSnapshot = `${addr.full_name}, ${addr.address_line}, ${addr.city}, ${addr.state} - ${addr.pincode}`;
      deliveryCity = String(addr.city || city || "").trim();
      const rules = getCityRules(city);
      if (subtotalAmount < rules.minAmount || totalItems < rules.minItems) {
        await client.query("ROLLBACK");
        return res.json({ ok: false, error: `Minimum order for ${city} is Rs ${rules.minAmount} and ${rules.minItems} item(s).` });
      }
    } else {
      await client.query("ROLLBACK"); return res.json({ ok: false, error: "Please select or add a delivery address" });
    }

    const orderColsResult = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'");
    const orderCols = new Set(orderColsResult.rows.map((r) => r.column_name));
    const orderPayload = [
      ["user_id", userId],
      ["subtotal_amount", subtotalAmount],
      ["coupon_id", appliedCoupon ? appliedCoupon.id : null],
      ["coupon_code", appliedCoupon ? appliedCoupon.code : null],
      ["coupon_discount", couponDiscount],
      ["total_amount", totalAmount],
      ["status", "Pending"],
      ["address", addressSnapshot],
      ["city", deliveryCity || null],
      ["address_id", finalAddressId],
      ["address_snapshot", addressSnapshot],
      ["payment_method", normalizedPaymentMethod],
      ["payment_status", "pending"],
      ["notes", notes || null]
    ].filter(([col]) => orderCols.has(col));

    const orderColumnsSql = orderPayload.map(([col]) => col).join(", ");
    const orderValues = orderPayload.map(([, val]) => val);
    const orderPlaceholders = orderPayload.map((_, idx) => `$${idx + 1}`).join(", ");
    const orderResult = await client.query(
      `INSERT INTO orders (${orderColumnsSql}) VALUES (${orderPlaceholders}) RETURNING *`,
      orderValues
    );
    const order = orderResult.rows[0];
    placedOrderId = order.id;

    const orderItemColsResult = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items'");
    const orderItemCols = new Set(orderItemColsResult.rows.map((r) => r.column_name));
    const supportsSelectedWeight = orderItemCols.has("selected_weight");

    for (const item of itemsResult.rows) {
      let finalPrice = Number(item.price);
      if (item.price_type === 'kg' && item.selected_weight) finalPrice = finalPrice * (parseWeightToKg(item.selected_weight) || 1);
      if (supportsSelectedWeight) {
        await client.query("INSERT INTO order_items (order_id, product_id, quantity, price, selected_weight) VALUES ($1,$2,$3,$4,$5)", [order.id, item.product_id, item.quantity, finalPrice, item.selected_weight]);
      } else {
        await client.query("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)", [order.id, item.product_id, item.quantity, finalPrice]);
      }
      await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [item.quantity, item.product_id]);
    }

    if (appliedCoupon) {
      await client.query("SAVEPOINT coupon_tracking");
      try {
        const couponColsResult = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coupons'");
        const couponCols = new Set(couponColsResult.rows.map((r) => r.column_name));
        if (couponCols.has("used_count")) await client.query("UPDATE coupons SET used_count = COALESCE(used_count, 0) + 1 WHERE id = $1", [appliedCoupon.id]);
        const usageColsResult = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coupon_usages'");
        const usageCols = new Set(usageColsResult.rows.map((r) => r.column_name));
        const usagePayload = [["coupon_id", appliedCoupon.id], ["user_id", userId], ["order_id", order.id], ["discount_amount", couponDiscount]].filter(([col]) => usageCols.has(col));
        if (usagePayload.length >= 3) {
          await client.query(`INSERT INTO coupon_usages (${usagePayload.map(([c]) => c).join(", ")}) VALUES (${usagePayload.map((_, i) => `$${i + 1}`).join(", ")})`, usagePayload.map(([, v]) => v));
        }
        await client.query("RELEASE SAVEPOINT coupon_tracking");
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT coupon_tracking");
        await client.query("RELEASE SAVEPOINT coupon_tracking");
      }
    }

    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cart.id]);
    await client.query("COMMIT");
    transactionCommitted = true;
    req.session.appliedCouponCode = null;

    setImmediate(async () => {
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)`,
          [userId, `Order received #${order.id}`, `We received your WhatsApp order for Rs ${Number(order.total_amount).toLocaleString("en-IN")}.`, "order"]
        );
        const opsUsers = await pool.query("SELECT id FROM users WHERE role IN ('admin', 'staff') AND COALESCE(is_blocked, false) = false");
        for (const u of opsUsers.rows) {
          await pool.query(
            `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)`,
            [u.id, `New WhatsApp Order #${order.id}`, `WhatsApp order placed by user ${userId} - total Rs ${Number(order.total_amount).toLocaleString("en-IN")}.`, "order"]
          );
        }
        await pool.query(
          "INSERT INTO staff_activities (user_id, action, details) SELECT id, 'WhatsApp Order Placed', $1::jsonb FROM users WHERE role IN ('admin','staff')",
          [JSON.stringify({ orderId: order.id, total: Number(order.total_amount), userId })]
        );
      } catch (e) { console.error("WhatsApp order notify error:", e); }
      try {
        const userResult = await pool.query("SELECT email, full_name FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length > 0) {
          const emailItems = itemsResult.rows.map((item) => {
            let finalPrice = Number(item.price);
            if (item.price_type === "kg" && item.selected_weight) finalPrice = finalPrice * (parseWeightToKg(item.selected_weight) || 1);
            return { ...item, price: finalPrice };
          });
          await sendOrderConfirmationEmail(userResult.rows[0].email, userResult.rows[0].full_name, order, emailItems);
        }
      } catch (e) { console.error("WhatsApp order email error:", e); }
    });

    return res.json({ ok: true, orderId: order.id });
  } catch (err) {
    if (!transactionCommitted) { try { await client.query("ROLLBACK"); } catch (e) {} }
    console.error("WhatsApp place order error:", err);
    return res.json({ ok: false, error: "Something went wrong. Please try again." });
  } finally {
    client.release();
  }
});

// ============================================================
// POST PLACE ORDER
// ============================================================
router.post("/place", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  let transactionCommitted = false;
  let placedOrderId = null;

  try {
    const userId = req.session.user.id;
    const { address_id, payment_method, notes, from } = req.body;
    const transactionIdRaw = req.body.transaction_id;
    const normalizedPaymentMethod = String(payment_method || "cod").toLowerCase();
    const sourceContext = String(from || "").trim().toLowerCase();
    const transactionId = String(transactionIdRaw || "").trim();
    const newAddressPayload = req.body.new_address || {
      full_name: req.body.full_name,
      phone: req.body.phone,
      address_line: req.body.address_line,
      city: req.body.city,
      state: req.body.state,
      pincode: req.body.pincode,
    };

    await client.query("BEGIN");

    if (!["cod", "upi", "whatsapp"].includes(normalizedPaymentMethod)) {
      await client.query("ROLLBACK");
      return res.redirect("/orders/checkout?error=Invalid payment method selected");
    }

    if (normalizedPaymentMethod === "upi" && !transactionId) {
      await client.query("ROLLBACK");
      return res.redirect("/orders/checkout?error=Please enter the transaction ID for UPI payment");
    }

    // Get cart
    const cartResult = await client.query("SELECT * FROM carts WHERE user_id = $1", [userId]);
    if (cartResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.redirect("/cart?error=Your cart is empty");
    }

    const cart = cartResult.rows[0];

    // Get cart items with stock
    const itemsResult = await client.query(
      `SELECT ci.product_id, ci.quantity, ci.selected_weight, p.category_id,
              CASE
                WHEN p.offer_active = true AND COALESCE(p.offer_percent, 0) > 0
                THEN ROUND((p.price * (1 - COALESCE(p.offer_percent, 0) / 100.0))::numeric, 2)
                ELSE p.price
              END AS price,
              p.name, p.stock, p.price_type
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
         AND COALESCE(p.is_enabled, true) = true`,
      [cart.id]
    );

    if (itemsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.redirect("/cart?error=Your cart is empty");
    }

    // -- Stock validation --
    for (const item of itemsResult.rows) {
      if (item.quantity > item.stock) {
        await client.query("ROLLBACK");
        return res.redirect(
          `/cart?error=${encodeURIComponent(`"${item.name}" only has ${item.stock} units left. Please update your cart.`)}`
        );
      }
    }

    let subtotalAmount = 0;
    let totalItems = 0;
    itemsResult.rows.forEach((item) => {
      let price = Number(item.price);
      if (item.price_type === 'kg' && item.selected_weight) {
        const multiplier = parseWeightToKg(item.selected_weight) || 1;
        price = price * multiplier;
      }
      subtotalAmount += price * item.quantity;
      totalItems += item.quantity;
    });

    const couponCode = normalizeCouponCode(req.session.appliedCouponCode);
    let appliedCoupon = null;
    let couponDiscount = 0;
    let totalAmount = subtotalAmount;
    const couponValidationItems = itemsResult.rows.map((item) => {
      let effectivePrice = Number(item.price || 0);
      if (item.price_type === "kg" && item.selected_weight) {
        effectivePrice = effectivePrice * (parseWeightToKg(item.selected_weight) || 1);
      }
      return {
        product_id: item.product_id,
        category_id: item.category_id,
        subtotal: effectivePrice * Number(item.quantity || 0),
        quantity: Number(item.quantity || 0),
        price: effectivePrice
      };
    });

    if (couponCode) {
      try {
        const couponState = await validateCouponForUser({
          client,
          code: couponCode,
          subtotal: subtotalAmount,
          userId,
          cartItems: couponValidationItems,
          lock: true
        });
        if (!couponState.ok) {
          await client.query("ROLLBACK");
          req.session.appliedCouponCode = null;
          return res.redirect(`/orders/checkout?error=${encodeURIComponent(couponState.error)}`);
        }
        appliedCoupon = couponState.coupon;
        couponDiscount = couponState.discount;
        totalAmount = Math.max(subtotalAmount - couponDiscount, 0);
      } catch (couponErr) {
        console.error("Coupon validation error during place order:", couponErr);
        req.session.appliedCouponCode = null;
        appliedCoupon = null;
        couponDiscount = 0;
        totalAmount = subtotalAmount;
      }
    }

    // -- Resolve address --
    let finalAddressId = null;
    let addressSnapshot = "";
    let deliveryCity = "";

    if (address_id && address_id !== "new") {
      const addrResult = await client.query(
        "SELECT * FROM addresses WHERE id = $1 AND user_id = $2",
        [address_id, userId]
      );
      if (addrResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.redirect("/orders/checkout?error=Invalid address selected");
      }
      const addr = addrResult.rows[0];
      if (!addr.phone || !String(addr.phone).trim()) {
        await client.query("ROLLBACK");
        return res.redirect("/orders/checkout?error=Selected address must include mobile number");
      }
      if (!addr.full_name || !addr.address_line || !addr.city || !addr.state || !addr.pincode) {
        await client.query("ROLLBACK");
        return res.redirect("/orders/checkout?error=Selected address is incomplete. Please update address and try again.");
      }
      finalAddressId = addr.id;
      addressSnapshot = `${addr.full_name}, ${addr.address_line}, ${addr.city}, ${addr.state} - ${addr.pincode}`;
      deliveryCity = String(addr.city || "").trim();

      // City minimum check
      const rules = getCityRules(addr.city);
      if (subtotalAmount < rules.minAmount || totalItems < rules.minItems) {
        await client.query("ROLLBACK");
        return res.redirect(
          `/orders/checkout?error=${encodeURIComponent(
            `Minimum order for ${addr.city} is Rs ${rules.minAmount} and ${rules.minItems} item(s).`
          )}`
        );
      }
    } else if (newAddressPayload && newAddressPayload.city) {
      // Save new address
      const { full_name, phone, address_line, city, state, pincode } = newAddressPayload;

      const phoneClean = String(phone || "").replace(/\s+/g, "");
      if (!full_name || !address_line || !city || !state || !pincode || !phoneClean) {
        await client.query("ROLLBACK");
        return res.redirect("/orders/checkout?error=Please fill in all address fields including mobile number");
      }
      if (!/^[0-9+\-()]{8,20}$/.test(phoneClean)) {
        await client.query("ROLLBACK");
        return res.redirect("/orders/checkout?error=Please enter a valid mobile number");
      }

      const newAddrResult = await client.query(
        `INSERT INTO addresses (user_id, full_name, phone, address_line, city, state, pincode)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [userId, full_name, phone || null, address_line, city, state, pincode]
      );
      const addr = newAddrResult.rows[0];
      finalAddressId = addr.id;
      addressSnapshot = `${addr.full_name}, ${addr.address_line}, ${addr.city}, ${addr.state} - ${addr.pincode}`;
      deliveryCity = String(addr.city || city || "").trim();

      const rules = getCityRules(city);
      if (subtotalAmount < rules.minAmount || totalItems < rules.minItems) {
        await client.query("ROLLBACK");
        return res.redirect(
          `/orders/checkout?error=${encodeURIComponent(
            `Minimum order for ${city} is Rs ${rules.minAmount} and ${rules.minItems} item(s).`
          )}`
        );
      }
    } else {
      await client.query("ROLLBACK");
      return res.redirect("/orders/checkout?error=Please select or add a delivery address");
    }

    // -- Create order --
    const orderColsResult = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'"
    );
    const orderCols = new Set(orderColsResult.rows.map((r) => r.column_name));
    const orderPayload = [
      ["user_id", userId],
      ["subtotal_amount", subtotalAmount],
      ["coupon_id", appliedCoupon ? appliedCoupon.id : null],
      ["coupon_code", appliedCoupon ? appliedCoupon.code : null],
      ["coupon_discount", couponDiscount],
      ["total_amount", totalAmount],
      ["status", "Pending"],
      ["address", addressSnapshot],
      ["city", deliveryCity || null],
      ["address_id", finalAddressId],
      ["address_snapshot", addressSnapshot],
      ["payment_method", normalizedPaymentMethod],
      ...(normalizedPaymentMethod === "upi"
        ? [
            ["transaction_id", transactionId],
            ["payment_status", "pending"],
          ]
        : []),
      ...(normalizedPaymentMethod === "whatsapp"
        ? [["payment_status", "pending"]]
        : []),
      ["notes", notes || null]
    ].filter(([col]) => orderCols.has(col));

    if (!orderPayload.some(([col]) => col === "user_id") || !orderPayload.some(([col]) => col === "total_amount")) {
      throw new Error("orders table is missing required columns");
    }

    const orderColumnsSql = orderPayload.map(([col]) => col).join(", ");
    const orderValues = orderPayload.map(([, val]) => val);
    const orderPlaceholders = orderPayload.map((_, idx) => `$${idx + 1}`).join(", ");
    const orderResult = await client.query(
      `INSERT INTO orders (${orderColumnsSql}) VALUES (${orderPlaceholders}) RETURNING *`,
      orderValues
    );

    const order = orderResult.rows[0];
    placedOrderId = order.id;

    const orderItemColsResult = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items'"
    );
    const orderItemCols = new Set(orderItemColsResult.rows.map((r) => r.column_name));
    const supportsSelectedWeight = orderItemCols.has("selected_weight");

    // -- Insert order items & deduct stock --
    for (const item of itemsResult.rows) {
      let finalPrice = Number(item.price);
      if (item.price_type === 'kg' && item.selected_weight) {
        finalPrice = finalPrice * (parseWeightToKg(item.selected_weight) || 1);
      }
      if (supportsSelectedWeight) {
        await client.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price, selected_weight) VALUES ($1,$2,$3,$4,$5)",
          [order.id, item.product_id, item.quantity, finalPrice, item.selected_weight]
        );
      } else {
        await client.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)",
          [order.id, item.product_id, item.quantity, finalPrice]
        );
      }

      // Deduct stock
      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.product_id]
      );
    }

    // -- Clear cart --
    if (appliedCoupon) {
      await client.query("SAVEPOINT coupon_tracking");
      try {
        const couponColsResult = await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coupons'"
        );
        const couponCols = new Set(couponColsResult.rows.map((r) => r.column_name));
        if (couponCols.has("used_count")) {
          await client.query(
            "UPDATE coupons SET used_count = COALESCE(used_count, 0) + 1 WHERE id = $1",
            [appliedCoupon.id]
          );
        }

        const usageColsResult = await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coupon_usages'"
        );
        const usageCols = new Set(usageColsResult.rows.map((r) => r.column_name));
        const usagePayload = [
          ["coupon_id", appliedCoupon.id],
          ["user_id", userId],
          ["order_id", order.id],
          ["discount_amount", couponDiscount]
        ].filter(([col]) => usageCols.has(col));

        if (usagePayload.length >= 3) {
          const usageColumnsSql = usagePayload.map(([col]) => col).join(", ");
          const usageValues = usagePayload.map(([, val]) => val);
          const usagePlaceholders = usagePayload.map((_, idx) => `$${idx + 1}`).join(", ");
          await client.query(
            `INSERT INTO coupon_usages (${usageColumnsSql}) VALUES (${usagePlaceholders})`,
            usageValues
          );
        }

        await client.query("RELEASE SAVEPOINT coupon_tracking");
      } catch (couponTrackErr) {
        await client.query("ROLLBACK TO SAVEPOINT coupon_tracking");
        await client.query("RELEASE SAVEPOINT coupon_tracking");
        console.error("Coupon tracking warning during place order:", couponTrackErr);
      }
    }

    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cart.id]);
    await client.query("COMMIT");
    transactionCommitted = true;
    req.session.appliedCouponCode = null;

    setImmediate(async () => {
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            `Order received #${order.id}`,
            `We received your order for Rs ${Number(order.total_amount).toLocaleString("en-IN")}.`,
            "order"
          ]
        );

        const opsUsers = await pool.query(
          "SELECT id FROM users WHERE role IN ('admin', 'staff') AND COALESCE(is_blocked, false) = false"
        );

        for (const u of opsUsers.rows) {
          await pool.query(
            `INSERT INTO notifications (user_id, title, message, type)
             VALUES ($1, $2, $3, $4)`,
            [
              u.id,
              `New order #${order.id}`,
              `Order placed by user ${userId} - total Rs ${Number(order.total_amount).toLocaleString("en-IN")}.`,
              "order"
            ]
          );
        }

        await pool.query(
          "INSERT INTO staff_activities (user_id, action, details) SELECT id, 'Order Placed', $1::jsonb FROM users WHERE role IN ('admin','staff')",
          [JSON.stringify({ orderId: order.id, total: Number(order.total_amount), userId })]
        );
      } catch (notifyErr) {
        console.error("Post-order async notify error:", notifyErr);
      }

      try {
        const userResult = await pool.query("SELECT email, full_name FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length > 0) {
          const emailItems = itemsResult.rows.map((item) => {
            let finalPrice = Number(item.price);
            if (item.price_type === "kg" && item.selected_weight) {
              finalPrice = finalPrice * (parseWeightToKg(item.selected_weight) || 1);
            }
            return { ...item, price: finalPrice };
          });

          await sendOrderConfirmationEmail(
            userResult.rows[0].email,
            userResult.rows[0].full_name,
            order,
            emailItems
          );
        }
      } catch (mailErr) {
        console.error("Post-order async mail error:", mailErr);
      }
    });

    const finalSuccessUrl = "/orders/success/" + order.id + (sourceContext === "scanpay" ? "?from=scanpay" : "");
    return res.redirect(finalSuccessUrl);
  } catch (err) {
    if (!transactionCommitted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Rollback error:", rollbackErr);
      }
    }
    if (transactionCommitted && placedOrderId) {
      console.error("Post-commit place order error:", err);
      return res.redirect("/orders/success/" + placedOrderId);
    }
    console.error("Place order error:", err);
    const errMsg = String(err && err.message ? err.message : "");
    if (errMsg.includes("subtotal_amount") || errMsg.includes("coupon_discount") || errMsg.includes("address_snapshot")) {
      return res.redirect("/orders/checkout?error=Checkout is syncing updates. Please refresh and try again.");
    }
    if (errMsg) {
      return res.redirect(`/orders/checkout?error=${encodeURIComponent(`Order failed: ${errMsg}`)}`);
    }
    res.redirect("/orders/checkout?error=Something went wrong. Please try again.");
  } finally {
    client.release();
  }
});

// ============================================================
// GET ORDER SUCCESS PAGE
// ============================================================
router.get("/success/:id", requireAuth, async (req, res, next) => {
  try {
    const orderResult = await pool.query(
      `SELECT orders.*, 
              addresses.full_name AS addr_name,
              addresses.address_line, addresses.city, addresses.state, addresses.pincode
       FROM orders 
       LEFT JOIN addresses ON addresses.id = orders.address_id
       WHERE orders.id = $1 AND orders.user_id = $2`,
      [req.params.id, req.session.user.id]
    );

    if (orderResult.rows.length === 0) return res.redirect("/orders");

    const order = orderResult.rows[0];

    const items = await pool.query(
      `SELECT oi.quantity, oi.price, oi.selected_weight, p.name, p.image
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    const computedItemsSubtotal = items.rows.reduce(
      (sum, item) => sum + (Number(item.price) * Number(item.quantity)),
      0
    );
    const itemsSubtotal = Number(order.subtotal_amount || computedItemsSubtotal);
    const couponDiscount = Number(order.coupon_discount || Math.max(itemsSubtotal - Number(order.total_amount || 0), 0));

    // Fetch suggested products (Best sellers not in this order)
    const suggestedProductsResult = await pool.query(
      `SELECT p.id, p.name, p.image, p.price, p.price_type, p.stock, c.name AS category_name,
              CASE
                WHEN p.offer_active = true AND COALESCE(p.offer_percent, 0) > 0
                THEN ROUND((p.price * (1 - COALESCE(p.offer_percent, 0) / 100.0))::numeric, 2)
                ELSE p.price
              END AS effective_price,
              COALESCE(
                (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id),
                0
              ) AS total_sold,
              COALESCE(
                (SELECT AVG(rating) FROM reviews WHERE product_id = p.id AND is_approved = true),
                0
              ) AS average_rating,
              (SELECT COUNT(*) FROM reviews WHERE product_id = p.id AND is_approved = true) AS review_count
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE COALESCE(p.is_enabled, true) = true 
         AND p.stock > 0
         AND p.id NOT IN (SELECT product_id FROM order_items WHERE order_id = $1)
       ORDER BY total_sold DESC NULLS LAST
       LIMIT 4`,
       [order.id]
    );

    res.render("order-confirmation", {
      title: "Order Confirmation",
      order,
      items: items.rows,
      itemsSubtotal,
      couponDiscount,
      couponCode: order.coupon_code || null,
      suggestedProducts: suggestedProductsResult.rows
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET USER ORDER HISTORY (with pagination)
// ============================================================
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM orders WHERE user_id = $1",
      [userId]
    );
    const totalOrders = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalOrders / limit);

    const orders = await pool.query(
      `SELECT orders.*,
              (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) AS item_count,
              (SELECT status FROM returns WHERE order_id = orders.id ORDER BY created_at DESC LIMIT 1) AS return_status
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.render("orders", {
      title: "My Orders",
      orders: orders.rows.map((o) => ({
        ...o,
        deliveryLabel: getDeliveryLabel(o),
        canCancel: isCancelableStatus(o.status),
        canReturn: !o.return_status && isReturnWindowOpen(o),
      })),
      currentPage: page,
      totalPages,
      totalOrders,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET SINGLE ORDER DETAIL (customer)
// ============================================================
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const orderResult = await pool.query(
      `SELECT orders.*, 
              addresses.full_name AS addr_name, addresses.phone AS addr_phone,
              addresses.address_line, addresses.city, addresses.state, addresses.pincode
       FROM orders 
       LEFT JOIN addresses ON addresses.id = orders.address_id
       WHERE orders.id = $1 AND orders.user_id = $2`,
      [req.params.id, req.session.user.id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).render("errors/404", { title: "Order Not Found", user: res.locals.user });
    }

    const order = orderResult.rows[0];

    const items = await pool.query(
      `SELECT oi.quantity, oi.price, oi.selected_weight, p.name, p.image, p.id AS product_id
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    // Order status timeline
    const statusTimeline = [
      { label: "Order Placed", status: "Pending", icon: "1" },
      { label: "Confirmed", status: "Confirmed", icon: "2" },
      { label: "Processing", status: "Processing", icon: "3" },
      { label: "Shipped", status: "Shipped", icon: "4" },
      { label: "Delivered", status: "Delivered", icon: "5" },
    ];

    const statuses = statusTimeline.map((s) => s.status);
    const currentIndex = statuses.indexOf(order.status);

    // Check for returns
    const returnReqResult = await pool.query("SELECT * FROM returns WHERE order_id = $1", [order.id]);
    const returnRequest = returnReqResult.rows.length > 0 ? returnReqResult.rows[0] : null;
    const canCancel = isCancelableStatus(order.status);
    const canReturn = !returnRequest && isReturnWindowOpen(order);

    res.render("order-detail", {
      title: `Order #${order.id}`,
      order,
      items: items.rows,
      statusTimeline,
      currentStatusIndex: currentIndex,
      returnRequest,
      canCancel,
      canReturn,
      returnWindowEndsAt: getReturnWindowEndsAt(order),
      deliveryLabel: getDeliveryLabel(order),
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST CANCEL ORDER
// ============================================================
router.post("/cancel/:id", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = req.session.user.id;
    const reason = String(req.body.reason || "").trim();
    if (reason.length < 3) {
      await client.query("ROLLBACK");
      return res.redirect(`/orders/${req.params.id}?error=Please enter a valid cancellation reason`);
    }

    const orderResult = await client.query(
      "SELECT * FROM orders WHERE id = $1 AND user_id = $2",
      [req.params.id, userId]
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.redirect("/orders");
    }

    const order = orderResult.rows[0];

    if (!isCancelableStatus(order.status)) {
      await client.query("ROLLBACK");
      return res.redirect(`/orders/${order.id}?error=Order cannot be cancelled at this stage`);
    }

    // Restore stock
    const items = await client.query(
      "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
      [order.id]
    );

    for (const item of items.rows) {
      await client.query(
        "UPDATE products SET stock = stock + $1 WHERE id = $2",
        [item.quantity, item.product_id]
      );
    }

    const orderColsResult = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'"
    );
    const orderCols = new Set(orderColsResult.rows.map((r) => r.column_name));
    if (orderCols.has("cancel_reason") && orderCols.has("delivered_at")) {
      await client.query(
        "UPDATE orders SET status = 'Cancelled', cancel_reason = $2, delivered_at = NULL WHERE id = $1",
        [order.id, reason]
      );
    } else if (orderCols.has("cancel_reason")) {
      await client.query(
        "UPDATE orders SET status = 'Cancelled', cancel_reason = $2 WHERE id = $1",
        [order.id, reason]
      );
    } else if (orderCols.has("delivered_at")) {
      await client.query(
        "UPDATE orders SET status = 'Cancelled', delivered_at = NULL WHERE id = $1",
        [order.id]
      );
    } else {
      await client.query("UPDATE orders SET status = 'Cancelled' WHERE id = $1", [order.id]);
    }
    await client.query("COMMIT");

    setImmediate(async () => {
      try {
        await notifyOps({
          title: `Order cancelled #${order.id}`,
          message: `User ${userId} cancelled order #${order.id}. Reason: ${reason}`,
          type: "order"
        });
        await pool.query(
          "INSERT INTO staff_activities (user_id, action, details) SELECT id, 'Order Cancelled', $1::jsonb FROM users WHERE role IN ('admin','staff')",
          [JSON.stringify({ orderId: order.id, userId, reason })]
        );
      } catch (notifyErr) {
        console.error("Cancel notification error:", notifyErr);
      }
    });

    res.redirect(`/orders/${order.id}?success=Order cancelled successfully`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Cancel order error:", err);
    res.redirect("/orders?error=Failed to cancel order");
  } finally {
    client.release();
  }
});
// ============================================================
// REQUEST RETURN
// ============================================================
router.post("/return/:id", requireAuth, async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim();
    const orderId = req.params.id;
    const userId = req.session.user.id;
    if (reason.length < 3) {
      return res.redirect(`/orders/${orderId}?error=Please enter a valid return reason`);
    }

    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1 AND user_id = $2", [orderId, userId]);
    if (orderResult.rows.length === 0) return res.redirect("/orders?error=Order not found");

    const order = orderResult.rows[0];
    if (order.status !== "Delivered") {
      return res.redirect(`/orders/${orderId}?error=Only delivered orders can be returned`);
    }
    if (!isReturnWindowOpen(order)) {
      return res.redirect(`/orders/${orderId}?error=Return window closed. Returns are allowed only within 2 days of delivery.`);
    }

    const existingReturn = await pool.query("SELECT * FROM returns WHERE order_id = $1", [orderId]);
    if (existingReturn.rows.length > 0) {
      return res.redirect(`/orders/${orderId}?error=Return already requested for this order`);
    }

    await pool.query("INSERT INTO returns (order_id, user_id, reason, status) VALUES ($1, $2, $3, 'Pending')", [orderId, userId, reason]);

    setImmediate(async () => {
      try {
        await notifyOps({
          title: `Return requested #${orderId}`,
          message: `User ${userId} requested return for order #${orderId}. Reason: ${reason}`,
          type: "return"
        });
        await pool.query(
          "INSERT INTO staff_activities (user_id, action, details) SELECT id, 'Return Requested', $1::jsonb FROM users WHERE role IN ('admin','staff')",
          [JSON.stringify({ orderId: Number(orderId), userId, reason })]
        );
      } catch (notifyErr) {
        console.error("Return notification error:", notifyErr);
      }
    });

    res.redirect(`/orders/${orderId}?success=Return requested successfully`);
  } catch (err) {
    console.error("Return error:", err);
    res.redirect(`/orders/${req.params.id}?error=Failed to submit return request`);
  }
});

module.exports = router;
