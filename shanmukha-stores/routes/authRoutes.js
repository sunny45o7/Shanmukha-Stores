const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { sendPasswordResetEmail, sendVerificationEmail } = require("../utils/mailer");
const { authLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

/* ===============================
   GET LOGIN PAGE
=============================== */
router.get("/login", (req, res) => {
  res.render("login", {
    title: "Login - Shanmukha Stores",
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

/* ===============================
   GET REGISTER PAGE
=============================== */
router.get("/register", (req, res) => {
  res.render("register", {
    title: "Register - Shanmukha Stores",
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

/* ===============================
   REGISTER
=============================== */
router.post("/register", authLimiter, async (req, res) => {
  try {
    const full_name = req.body.full_name || req.body.name || req.body.username || "";
    let email = req.body.email || null;
    const password = req.body.password;
    const confirm_password = req.body.confirm_password;
    const phone = req.body.phone || req.body.mobile || null;

    if (!full_name || !phone || !password || !confirm_password) {
      return res.redirect("/auth/register?error=Please fill all required fields");
    }

    if (password !== confirm_password) {
      return res.redirect("/auth/register?error=Passwords do not match");
    }

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.redirect("/auth/register?error=Please enter a valid email address");
      }
      const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) {
        return res.redirect("/auth/register?error=Email already registered");
      }
    } else {
      email = `${phone.replace(/\D/g, '')}@shanmukha.local`;
      const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      if (existing.rows.length > 0) {
        return res.redirect("/auth/register?error=This mobile number is already registered.");
      }
    }

    if (password.length < 8) {
      return res.redirect("/auth/register?error=Password must be at least 8 characters long");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const insertResult = await pool.query(
      "INSERT INTO users (full_name, email, phone, password, role) VALUES ($1, $2, $3, $4, 'user') RETURNING id",
      [full_name, email, phone, hashedPassword]
    );

    if (process.env.JWT_SECRET && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const token = jwt.sign(
        { id: insertResult.rows[0].id, purpose: "verify" },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );
      sendVerificationEmail(email, full_name, token).catch((err) => {
        console.error("Verification email send error:", err.message);
      });
    }

    res.redirect("/auth/login?success=Account created successfully! Please login.");
  } catch (err) {
    console.error("Register error:", err.message);
    res.redirect("/auth/register?error=" + encodeURIComponent(err.message));
  }
});

/* ===============================
   LOGIN
=============================== */
router.post("/login", authLimiter, async (req, res) => {
  try {
    const login_id = req.body.login_id || req.body.email;
    const password = req.body.password;

    if (!login_id || !password) {
      return res.redirect("/auth/login?error=Please enter email/mobile and password");
    }

    const result = await pool.query("SELECT * FROM users WHERE email = $1 OR phone = $1", [login_id]);
    if (result.rows.length === 0) {
      return res.redirect("/auth/login?error=No account found with this email/mobile");
    }

    const user = result.rows[0];

    if (user.is_blocked) {
      return res.redirect("/auth/login?error=Your account has been blocked");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.redirect("/auth/login?error=Incorrect password");
    }

    req.session.user = {
      id: user.id,
      name: user.full_name,
      role: user.role || "user",
      profile_image: user.profile_image || null,
    };

    if (user.role === "admin" || user.role === "staff") {
      await pool.query(
        "INSERT INTO staff_activities (user_id, action, details) VALUES ($1, $2, $3)",
        [
          user.id,
          user.role === "admin" ? "Admin Login" : "Staff Login",
          JSON.stringify({
            role: user.role,
            email: user.email,
            ip: req.ip || null,
            user_agent: req.get("user-agent") || null,
          }),
        ]
      );
    }

    if (user.role === "staff") {
      return res.redirect("/staff/dashboard");
    }
    if (user.role === "admin") {
      return res.redirect("/admin/dashboard");
    }
    res.redirect("/");
  } catch (err) {
    console.error("Login error:", err.message);
    res.redirect("/auth/login?error=Login failed. Please try again.");
  }
});

/* ===============================
   LOGOUT
=============================== */
router.post("/logout", async (req, res) => {
  try {
    if (req.session && req.session.user && (req.session.user.role === "admin" || req.session.user.role === "staff")) {
      await pool.query(
        "INSERT INTO staff_activities (user_id, action, details) VALUES ($1, $2, $3)",
        [
          req.session.user.id,
          req.session.user.role === "admin" ? "Admin Logout" : "Staff Logout",
          JSON.stringify({
            role: req.session.user.role,
            ip: req.ip || null,
            user_agent: req.get("user-agent") || null,
          }),
        ]
      );
    }
  } catch (err) {
    console.error("Logout activity log error:", err.message);
  }

  req.session.destroy(() => {
    res.clearCookie("token");
    res.redirect("/");
  });
});

/* ===============================
   FORGOT PASSWORD
=============================== */
router.get("/forgot-password", (req, res) => {
  res.render("auth/forgot-password", {
    title: "Forgot Password",
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

router.post("/forgot-password", authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.redirect("/auth/forgot-password?error=Email is required");
    }

    const result = await pool.query(
      "SELECT id, full_name, email, password FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.redirect("/auth/forgot-password?success=If this email exists, a reset link has been sent.");
    }

    const user = result.rows[0];
    const baseSecret = process.env.JWT_SECRET;
    if (!baseSecret || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.redirect("/auth/forgot-password?success=Password reset email is temporarily unavailable. Please contact support.");
    }

    const token = jwt.sign(
      { id: user.id, purpose: "reset" },
      `${baseSecret}${user.password}`,
      { expiresIn: "1h" }
    );

    await sendPasswordResetEmail(user.email, user.full_name, token);
    return res.redirect("/auth/forgot-password?success=If this email exists, a reset link has been sent.");
  } catch (err) {
    console.error("Forgot password error:", err.message);
    return res.redirect("/auth/forgot-password?error=Unable to process request right now.");
  }
});

/* ===============================
   RESET PASSWORD
=============================== */
router.get("/reset-password", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.redirect("/auth/forgot-password?error=Missing reset token");
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id) {
      return res.redirect("/auth/forgot-password?error=Invalid reset token");
    }

    const userResult = await pool.query("SELECT id, password FROM users WHERE id = $1", [decoded.id]);
    if (userResult.rows.length === 0) {
      return res.redirect("/auth/forgot-password?error=Invalid reset token");
    }

    const secret = `${process.env.JWT_SECRET || ""}${userResult.rows[0].password}`;
    jwt.verify(token, secret);

    return res.render("auth/reset-password", {
      title: "Reset Password",
      token,
      error: req.query.error || null,
    });
  } catch (err) {
    return res.redirect("/auth/forgot-password?error=Reset token expired or invalid");
  }
});

router.post("/reset-password", authLimiter, async (req, res) => {
  try {
    const { token, password, confirm_password } = req.body;

    if (!token) return res.redirect("/auth/forgot-password?error=Missing reset token");
    if (!password || password.length < 8) {
      return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=Password must be at least 8 characters long`);
    }
    if (password !== confirm_password) {
      return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=Passwords do not match`);
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id) {
      return res.redirect("/auth/forgot-password?error=Invalid reset token");
    }

    const userResult = await pool.query("SELECT id, password FROM users WHERE id = $1", [decoded.id]);
    if (userResult.rows.length === 0) {
      return res.redirect("/auth/forgot-password?error=Invalid reset token");
    }

    const secret = `${process.env.JWT_SECRET || ""}${userResult.rows[0].password}`;
    const verified = jwt.verify(token, secret);
    if (!verified || verified.purpose !== "reset") {
      return res.redirect("/auth/forgot-password?error=Invalid reset token");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, decoded.id]);

    return res.redirect("/auth/login?success=Password reset successful. Please login.");
  } catch (err) {
    return res.redirect("/auth/forgot-password?error=Reset token expired or invalid");
  }
});

/* ===============================
   EMAIL VERIFICATION
=============================== */
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || !process.env.JWT_SECRET) {
      return res.redirect("/auth/login?error=Invalid verification link");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || decoded.purpose !== "verify" || !decoded.id) {
      return res.redirect("/auth/login?error=Invalid verification link");
    }

    await pool.query("UPDATE users SET is_verified = true WHERE id = $1", [decoded.id]);
    return res.redirect("/auth/login?success=Email verified successfully. You can login now.");
  } catch (err) {
    return res.redirect("/auth/login?error=Verification link expired or invalid");
  }
});

router.post("/resend-verification", authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.redirect("/auth/login?error=Email is required");

    const userResult = await pool.query(
      "SELECT id, full_name, email, is_verified FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.redirect("/auth/login?success=If your email exists, a verification link was sent.");
    }

    const user = userResult.rows[0];
    if (user.is_verified) {
      return res.redirect("/auth/login?success=Your email is already verified.");
    }

    if (!process.env.JWT_SECRET || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.redirect("/auth/login?error=Email service is not configured.");
    }

    const token = jwt.sign(
      { id: user.id, purpose: "verify" },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    await sendVerificationEmail(user.email, user.full_name, token);
    return res.redirect("/auth/login?success=Verification email sent.");
  } catch (err) {
    console.error("Resend verification error:", err.message);
    return res.redirect("/auth/login?error=Unable to resend verification email.");
  }
});

router.use((req, res) => {
  res.status(404).render("errors/404", {
    title: "Page Not Found",
    user: res.locals.user,
  });
});

module.exports = router;
