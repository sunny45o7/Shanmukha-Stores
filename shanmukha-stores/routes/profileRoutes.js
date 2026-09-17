const express = require("express");
const bcrypt = require("bcrypt");
const { body, validationResult } = require("express-validator");
const pool = require("../config/db");

const router = express.Router();

// ============================================================
// AUTH GUARD
// ============================================================
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
};

// ============================================================
// GET PROFILE PAGE
// ============================================================
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [userResult, ordersResult, addressesResult] = await Promise.all([
      pool.query("SELECT id, full_name AS name, email, phone, profile_image, created_at, is_verified FROM users WHERE id = $1", [userId]),
      pool.query(
        `SELECT orders.*, 
                (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) AS item_count
         FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [userId]
      ),
      pool.query("SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC", [userId]),
    ]);

    if (userResult.rows.length === 0) return res.redirect("/auth/login");

    res.render("user-profile", {
      title: "My Profile",
      profileUser: userResult.rows[0],
      recentOrders: ordersResult.rows,
      addresses: addressesResult.rows,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).send("Profile error: " + err.message);
  }
});

// ============================================================
// POST UPDATE PROFILE
// ============================================================
router.post(
  "/update",
  requireAuth,
  [
    body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Name must be 2–100 characters"),
    body("phone").optional({ checkFalsy: true }).isMobilePhone("any").withMessage("Valid phone number required"),
    body("profile_image")
      .optional({ checkFalsy: true })
      .custom((value) => {
        const v = String(value || "").trim();
        if (!v) return true;
        if (/^https?:\/\/.+/i.test(v)) return true;
        throw new Error("Profile image must be a valid image URL");
      }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.redirect("/profile?error=" + encodeURIComponent(errors.array()[0].msg));
      }

      const { name, phone, profile_image } = req.body;
      const userId = req.session.user.id;

      await pool.query(
        "UPDATE users SET full_name = $1, phone = $2, profile_image = $3 WHERE id = $4",
        [name, phone || null, (profile_image || "").trim() || null, userId]
      );

      // Update session
      req.session.user.name = name;
      req.session.user.profile_image = (profile_image || "").trim() || null;

      res.redirect("/profile?success=Profile updated successfully");
    } catch (err) {
      console.error("Update profile error:", err);
      res.redirect("/profile?error=Failed to update profile");
    }
  }
);

// ============================================================
// POST CHANGE PASSWORD
// ============================================================
router.post(
  "/change-password",
  requireAuth,
  [
    body("current_password").notEmpty().withMessage("Current password is required"),
    body("new_password")
      .isLength({ min: 6 }).withMessage("New password must be at least 6 characters")
      .matches(/[A-Z]/).withMessage("Must contain an uppercase letter")
      .matches(/[0-9]/).withMessage("Must contain a number"),
    body("confirm_password").custom((val, { req }) => {
      if (val !== req.body.new_password) throw new Error("Passwords do not match");
      return true;
    }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.redirect("/profile?error=" + encodeURIComponent(errors.array()[0].msg));
      }

      const { current_password, new_password } = req.body;
      const userId = req.session.user.id;

      const result = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
      if (result.rows.length === 0) return res.redirect("/auth/login");

      const isMatch = await bcrypt.compare(current_password, result.rows[0].password);
      if (!isMatch) {
        return res.redirect("/profile?error=Current password is incorrect");
      }

      const hashedPassword = await bcrypt.hash(new_password, 12);
      await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, userId]);

      res.redirect("/profile?success=Password changed successfully");
    } catch (err) {
      console.error("Change password error:", err);
      res.redirect("/profile?error=Failed to change password");
    }
  }
);

const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const profileUploadDir = path.join(__dirname, "..", "public", "uploads", "profiles");
if (!fs.existsSync(profileUploadDir)) {
  fs.mkdirSync(profileUploadDir, { recursive: true });
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image files are allowed"));
  }
});

// ============================================================
// POST UPLOAD PROFILE IMAGE (AJAX)
// ============================================================
router.post("/upload-image", requireAuth, upload.single("profile_image_file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No image file provided" });

    const userId = req.session.user.id;
    const ext = path.extname(req.file.originalname) || ".jpg";
    const filename = `profile_${userId}_${Date.now()}${ext}`;
    const filepath = path.join(profileUploadDir, filename);

    await sharp(req.file.buffer)
      .resize(200, 200, { fit: "cover" })
      .toFile(filepath);

    const imageUrl = `/uploads/profiles/${filename}`;

    await pool.query("UPDATE users SET profile_image = $1 WHERE id = $2", [imageUrl, userId]);
    req.session.user.profile_image = imageUrl;

    res.json({ success: true, url: imageUrl });
  } catch (err) {
    console.error("Profile image upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.use((req, res) => {
  res.status(404).render("errors/404", {
    title: "Page Not Found",
    user: res.locals.user,
  });
});

module.exports = router;
