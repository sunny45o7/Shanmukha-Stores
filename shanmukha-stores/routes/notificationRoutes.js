const express = require("express");
const pool = require("../config/db");

const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
};

router.post("/read/:id", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.user.id]
    );
    return res.redirect(req.get("referer") || "/");
  } catch (err) {
    return res.redirect(req.get("referer") || "/");
  }
});

router.post("/read-all", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
      [req.session.user.id]
    );
    return res.redirect(req.get("referer") || "/");
  } catch (err) {
    return res.redirect(req.get("referer") || "/");
  }
});

router.use((req, res) => {
  res.status(404).render("errors/404", {
    title: "Page Not Found",
    user: res.locals.user,
  });
});

module.exports = router;
