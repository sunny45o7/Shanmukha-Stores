const express = require("express");
const pool = require("../config/db");

const router = express.Router();

const canAccessStaffPanel = (req, res, next) => {
  if (!req.session.user) return res.redirect("/auth/login");
  if (req.session.user.role !== "staff" && req.session.user.role !== "admin") {
    return res.redirect("/auth/login?error=Staff access required");
  }
  next();
};

router.get("/", canAccessStaffPanel, (req, res) => res.redirect("/staff/dashboard"));

// ============================================================
// API: STAFF SEARCH SUGGESTIONS
// ============================================================
router.get('/api/search/suggestions', canAccessStaffPanel, async (req, res) => {
    try {
        const { q, type } = req.query;
        if (!q || q.trim().length < 1) return res.json([]);
        const query = `%${q.trim()}%`;
        let result = [];
        
        if (type === 'all' || !type) {
            const [p, o] = await Promise.all([
                pool.query("SELECT id, name, image FROM products WHERE name ILIKE $1 ORDER BY name ASC LIMIT 3", [query]),
                pool.query("SELECT o.id, o.total_amount, o.status as payment_status, u.full_name as name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id::text ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1 LIMIT 3", [query])
            ]);
            result = [
                ...p.rows.map(item => ({ id: item.id, label: item.name, sub: 'Product', image: item.image, url: `/products/${item.id}` })),
                ...o.rows.map(item => ({ id: item.id, label: `Order #${item.id} - ${item.name}`, sub: `Order • ₹${item.total_amount} (${item.payment_status})`, url: `/staff/orders?search=${encodeURIComponent(item.id)}` }))
            ];
        } else if (type === 'orders') {
            const r = await pool.query("SELECT o.id, o.total_amount, o.status as payment_status, u.full_name as name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id::text ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1 LIMIT 6", [query]);
            result = r.rows.map(item => ({ id: item.id, label: `Order #${item.id} - ${item.name}`, sub: `₹${item.total_amount} (${item.payment_status})`, url: `/staff/orders?search=${encodeURIComponent(item.id)}` }));
        }
        res.json(result);
    } catch (err) {
        console.error("Staff Search API Error:", err.message);
        res.status(500).json([]);
    }
});

router.get("/dashboard", canAccessStaffPanel, async (req, res) => {
  try {
    const [allOrders, pending, processing, delivered, recent] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM orders"),
      pool.query("SELECT COUNT(*) FROM orders WHERE status = 'Pending'"),
      pool.query("SELECT COUNT(*) FROM orders WHERE status = 'Processing'"),
      pool.query("SELECT COUNT(*) FROM orders WHERE status = 'Delivered'"),
      pool.query(
        `SELECT o.*, u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone\n             FROM orders o\n             JOIN users u ON u.id = o.user_id
         ORDER BY o.created_at DESC
         LIMIT 10`
      ),
    ]);

    res.render("staff/dashboard", {
      title: "Staff Dashboard",
      user: req.session.user,
      stats: {
        orders: Number(allOrders.rows[0].count || 0),
        pending: Number(pending.rows[0].count || 0),
        processing: Number(processing.rows[0].count || 0),
        delivered: Number(delivered.rows[0].count || 0),
      },
      recentOrders: recent.rows,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    res.redirect("/staff/orders?error=" + encodeURIComponent(err.message));
  }
});

router.get("/orders", canAccessStaffPanel, async (req, res) => {
  try {
    const { status, search } = req.query;
    let q = `SELECT o.*, u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone\n             FROM orders o\n             JOIN users u ON u.id = o.user_id`;
    const params = [];
    const where = [];
    if (status && status !== "all") {
      params.push(status);
      where.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR CAST(o.id AS TEXT) ILIKE $${params.length})`);
    }
    if (where.length) q += " WHERE " + where.join(" AND ");
    q += " ORDER BY o.created_at DESC";

    const orders = await pool.query(q, params);
    res.render("staff/orders", {
      title: "Staff Orders",
      user: req.session.user,
      orders: orders.rows,
      currentStatus: status || "all",
      search: search || "",
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

router.post("/orders/status/:id", canAccessStaffPanel, async (req, res) => {
  try {
    const { status, estimated_delivery_at, delivery_note } = req.body;
    const eta = estimated_delivery_at && String(estimated_delivery_at).trim().length
      ? new Date(estimated_delivery_at)
      : null;
    if (eta && Number.isNaN(eta.getTime())) {
      return res.redirect("/staff/orders?error=Invalid delivery date/time");
    }

    const existingOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [req.params.id]);
    if (existingOrder.rows.length && existingOrder.rows[0].status === 'Cancelled') {
      return res.redirect("/staff/orders?error=Cannot update a cancelled order");
    }

    await pool.query(
      `UPDATE orders
       SET status = $1,
           estimated_delivery_at = $2,
           delivery_note = $3,
           delivered_at = CASE
             WHEN $1 = 'Delivered' THEN COALESCE(delivered_at, NOW())
             WHEN $1 <> 'Delivered' THEN NULL
             ELSE delivered_at
           END
       WHERE id = $4`,
      [status, eta ? eta.toISOString() : null, delivery_note || null, req.params.id]
    );
    return res.redirect("/staff/orders?success=Order status updated");
  } catch (err) {
    return res.redirect("/staff/orders?error=" + encodeURIComponent(err.message));
  }
});

router.get("/returns", canAccessStaffPanel, async (req, res) => {
  try {
    const returnsResult = await pool.query(
      `SELECT r.*,
              o.id AS order_number, o.status AS order_status, o.total_amount, o.cancel_reason,
              u.full_name AS user_name, u.email AS user_email
       FROM returns r
       JOIN orders o ON o.id = r.order_id
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`
    );
    res.render("staff/returns", {
      title: "Staff Returns",
      user: req.session.user,
      returns: returnsResult.rows,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    res.redirect("/staff/orders?error=" + encodeURIComponent(err.message));
  }
});

router.post("/returns/status/:id", canAccessStaffPanel, async (req, res) => {
  try {
    const { status } = req.body;
    const existingReturn = await pool.query("SELECT status FROM returns WHERE id = $1", [req.params.id]);
    if (existingReturn.rows.length && (existingReturn.rows[0].status === 'Refunded' || existingReturn.rows[0].status === 'Rejected')) {
      return res.redirect("/staff/returns?error=Cannot update a terminal return status");
    }
    await pool.query("UPDATE returns SET status = $1 WHERE id = $2", [status, req.params.id]);
    return res.redirect("/staff/returns?success=" + encodeURIComponent("Return status updated to " + status));
  } catch (err) {
    return res.redirect("/staff/returns?error=" + encodeURIComponent(err.message));
  }
});

router.get("/orders/:id", canAccessStaffPanel, async (req, res) => {
  try {
    const order = await pool.query(
      `SELECT o.*, u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order.rows.length) return res.redirect("/staff/orders?error=Order not found");

    const items = await pool.query(
      `SELECT oi.*, p.name, p.image
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );
    const returnReq = await pool.query(
      "SELECT * FROM returns WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
      [req.params.id]
    );

    res.render("staff/order-detail", {
      title: "Staff Order Detail",
      user: req.session.user,
      order: order.rows[0],
      items: items.rows,
      returnRequest: returnReq.rows[0] || null,
    });
  } catch (err) {
    res.redirect("/staff/orders?error=" + encodeURIComponent(err.message));
  }
});

router.get("/orders/:id/bill", canAccessStaffPanel, async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT o.*, u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!orderResult.rows.length) return res.redirect("/staff/orders?error=Order not found");

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

    res.render("admin/order-bill", {
      title: `Order Bill #${req.params.id}`,
      user: req.session.user,
      order: orderResult.rows[0],
      items,
      subtotal,
      discount,
      total,
    });
  } catch (err) {
    res.redirect("/staff/orders?error=" + encodeURIComponent(err.message));
  }
});

router.get("/payments", canAccessStaffPanel, async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT orders.*, users.full_name AS user_name, users.email AS user_email
       FROM orders 
       JOIN users ON users.id = orders.user_id
       ORDER BY orders.created_at DESC`
    );
    res.render("staff/payments", {
      title: "Payments",
      user: req.session.user,
      orders: orders.rows,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

module.exports = router;
