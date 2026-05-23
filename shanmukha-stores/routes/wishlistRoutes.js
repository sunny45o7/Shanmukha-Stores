const express = require("express");
const router = express.Router();
const pool = require("../config/db");

const wantsJson = (req) => {
  const accept = req.get("accept") || "";
  return req.xhr || accept.includes("application/json");
};

/*
   =====================================
   GET USER WISHLIST
   =====================================
*/
router.get("/", async (req, res) => {
  try {

    if (!req.session.user) {
      return res.redirect('/auth/login'); // ✅
    }

    const userId = req.session.user.id;

    const result = await pool.query(`
      SELECT p.*, w.product_id
      FROM wishlist w
      JOIN products p ON w.product_id = p.id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
    `, [userId]);

    res.render("wishlist", { title: "My Wishlist", wishlist: result.rows });

  } catch (err) {
    console.error("Error fetching wishlist:", err);
    res.status(500).send("Server Error");
  }
});


/*
   =====================================
   TOGGLE WISHLIST (ADD / REMOVE)
   =====================================
*/
router.post("/toggle/:productId", async (req, res) => {
  try {
    if (!req.session.user) {
      if (wantsJson(req)) {
        return res.status(401).json({ ok: false, message: "Login required", redirect: "/auth/login" });
      }
      return res.redirect('/auth/login');
    }

    const userId = req.session.user.id;
    const productId = req.params.productId;
    const redirectBack = req.get('Referer') || '/products';

    const existing = await pool.query(
      `SELECT * FROM wishlist WHERE user_id = $1 AND product_id = $2`,
      [userId, productId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2`,
        [userId, productId]
      );
      if (wantsJson(req)) {
        return res.json({ ok: true, status: "removed" });
      }
    } else {
      await pool.query(
        `INSERT INTO wishlist (user_id, product_id) VALUES ($1, $2)`,
        [userId, productId]
      );
      if (wantsJson(req)) {
        return res.json({ ok: true, status: "added" });
      }
    }

    return res.redirect(redirectBack);

  } catch (err) {
    console.error("Wishlist toggle error:", err);
    if (wantsJson(req)) {
      return res.status(500).json({ ok: false, message: "Failed to update wishlist" });
    }
    res.redirect('/products');
  }
});

/*
   =====================================
   REMOVE ITEM (compat route)
   =====================================
*/
router.post("/remove/:productId", async (req, res) => {
  try {
    if (!req.session.user) {
      if (wantsJson(req)) {
        return res.status(401).json({ ok: false, message: "Login required", redirect: "/auth/login" });
      }
      return res.redirect("/auth/login");
    }
    const userId = req.session.user.id;
    const productId = req.params.productId;
    await pool.query(
      "DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2",
      [userId, productId]
    );
    if (wantsJson(req)) {
      return res.json({ ok: true, status: "removed" });
    }
    return res.redirect("/wishlist");
  } catch (err) {
    console.error("Wishlist remove error:", err);
    if (wantsJson(req)) {
      return res.status(500).json({ ok: false, message: "Failed to remove from wishlist" });
    }
    return res.redirect("/wishlist");
  }
});

router.use((req, res) => {
  res.status(404).render("errors/404", {
    title: "Page Not Found",
    user: res.locals.user,
  });
});

module.exports = router;
