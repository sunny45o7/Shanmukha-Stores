const pool = require("../config/db");

const attachUser = async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.wishlistCount = 0;
  res.locals.cartCount = 0;
  res.locals.unreadNotificationCount = 0;
  res.locals.notifications = [];

  if (req.session.user) {
    try {
      // Re-verify user is not blocked on every request
      const userCheck = await pool.query(
        "SELECT id, full_name, is_blocked, is_verified, role, profile_image FROM users WHERE id = $1",
        [req.session.user.id]
      );

      if (userCheck.rows.length === 0 || userCheck.rows[0].is_blocked) {
        // Force logout if user is deleted or blocked
        req.session.destroy();
        return res.redirect("/auth/login?error=Your account has been suspended.");
      }

      // Keep session user details in sync with DB profile updates
      req.session.user.name = userCheck.rows[0].full_name;
      req.session.user.role = userCheck.rows[0].role || req.session.user.role;
      req.session.user.profile_image = userCheck.rows[0].profile_image || null;

      // Wishlist
      const wishlist = await pool.query(
        "SELECT product_id FROM wishlist WHERE user_id = $1",
        [req.session.user.id]
      );
      res.locals.wishlistCount = wishlist.rows.length;
      res.locals.wishlistProductIds = wishlist.rows.map(r => Number(r.product_id));

      // Cart count
      const cart = await pool.query(
        `SELECT COALESCE(SUM(ci.quantity), 0) AS count
         FROM carts c
         JOIN cart_items ci ON ci.cart_id = c.id
         WHERE c.user_id = $1`,
        [req.session.user.id]
      );
      res.locals.cartCount = parseInt(cart.rows[0].count);

      // Notification badge + latest notifications for dropdown
      const [unreadResult, notificationsResult] = await Promise.all([
        pool.query(
          "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false",
          [req.session.user.id]
        ),
        pool.query(
          `SELECT id, title, message, type, is_read, created_at
           FROM notifications
           WHERE user_id = $1 AND is_read = false
           ORDER BY created_at DESC
           LIMIT 6`,
          [req.session.user.id]
        )
      ]);
      res.locals.unreadNotificationCount = Number(unreadResult.rows[0]?.count || 0);
      res.locals.notifications = notificationsResult.rows || [];

    } catch (err) {
      console.error("Middleware error:", err);
    }
  }

  next();
};

module.exports = attachUser;
