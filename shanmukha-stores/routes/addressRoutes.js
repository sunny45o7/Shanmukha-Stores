const express = require("express");
const { body, validationResult } = require("express-validator");
const pool = require("../config/db");

const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
};

const addressValidation = [
  body("full_name").trim().isLength({ min: 2, max: 100 }).withMessage("Full name required"),
  body("phone").isMobilePhone("any").withMessage("Valid phone number required"),
  body("address_line").trim().isLength({ min: 5 }).withMessage("Address is required"),
  body("city").trim().notEmpty().withMessage("City is required"),
  body("state").trim().notEmpty().withMessage("State is required"),
  body("pincode").trim().isLength({ min: 4, max: 10 }).withMessage("Valid pincode required"),
];

// ============================================================
// GET ALL ADDRESSES
// ============================================================
router.get("/", requireAuth, async (req, res) => {
  try {
    const addresses = await pool.query(
      "SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC",
      [req.session.user.id]
    );

    res.render("addresses", {
      title: "My Addresses",
      addresses: addresses.rows,
      from: req.query.from || "",
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    console.error("Addresses error:", err);
    res.status(500).send("Error: " + err.message);
  }
});

// ============================================================
// POST ADD ADDRESS
// ============================================================
router.post("/add", requireAuth, addressValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/addresses?error=" + encodeURIComponent(errors.array()[0].msg));
    }

    const { full_name, phone, address_line, city, state, pincode, is_default } = req.body;
    const userId = req.session.user.id;

    if (is_default) {
      await pool.query("UPDATE addresses SET is_default = false WHERE user_id = $1", [userId]);
    }

    await pool.query(
      `INSERT INTO addresses (user_id, full_name, phone, address_line, city, state, pincode, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, full_name, phone, address_line, city, state, pincode, is_default ? true : false]
    );

    const redirectTo = req.query.from === "checkout" ? "/orders/checkout" : "/addresses";
    res.redirect(redirectTo + "?success=Address added successfully");
  } catch (err) {
    console.error("Add address error:", err);
    res.redirect("/addresses?error=Failed to add address");
  }
});

// ============================================================
// POST EDIT ADDRESS
// ============================================================
router.post("/edit/:id", requireAuth, addressValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect("/addresses?error=" + encodeURIComponent(errors.array()[0].msg));
    }

    const { full_name, phone, address_line, city, state, pincode, is_default } = req.body;
    const userId = req.session.user.id;
    const addressId = req.params.id;

    // Verify ownership
    const check = await pool.query(
      "SELECT id FROM addresses WHERE id = $1 AND user_id = $2",
      [addressId, userId]
    );
    if (check.rows.length === 0) return res.redirect("/addresses?error=Address not found");

    if (is_default) {
      await pool.query("UPDATE addresses SET is_default = false WHERE user_id = $1", [userId]);
    }

    await pool.query(
      `UPDATE addresses SET full_name=$1, phone=$2, address_line=$3, city=$4, state=$5, pincode=$6, is_default=$7
       WHERE id=$8 AND user_id=$9`,
      [full_name, phone, address_line, city, state, pincode, is_default ? true : false, addressId, userId]
    );

    res.redirect("/addresses?success=Address updated successfully");
  } catch (err) {
    console.error("Edit address error:", err);
    res.redirect("/addresses?error=Failed to update address");
  }
});

// ============================================================
// POST DELETE ADDRESS
// ============================================================
router.post("/delete/:id", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM addresses WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.user.id]
    );
    res.redirect("/addresses?success=Address deleted");
  } catch (err) {
    console.error("Delete address error:", err);
    res.redirect("/addresses?error=Failed to delete address");
  }
});

// ============================================================
// POST SET DEFAULT ADDRESS
// ============================================================
router.post("/set-default/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    await pool.query("UPDATE addresses SET is_default = false WHERE user_id = $1", [userId]);
    await pool.query(
      "UPDATE addresses SET is_default = true WHERE id = $1 AND user_id = $2",
      [req.params.id, userId]
    );
    res.redirect("/addresses?success=Default address updated");
  } catch (err) {
    console.error("Set default error:", err);
    res.redirect("/addresses?error=Failed to update default address");
  }
});

router.use((req, res) => {
  res.status(404).render("errors/404", {
    title: "Page Not Found",
    user: res.locals.user,
  });
});

module.exports = router;
