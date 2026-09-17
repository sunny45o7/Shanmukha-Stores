const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    status: 429,
    message: "Too many authentication requests, please try again after 15 minutes."
  },
  handler: (req, res, next, options) => {
    // If the request accepts HTML, redirect to the page with an error message
    if (req.accepts("html")) {
      const errorMsg = encodeURIComponent(options.message.message);
      if (req.path === "/forgot-password") {
        return res.redirect(`/auth/forgot-password?error=${errorMsg}`);
      } else if (req.path === "/register") {
        return res.redirect(`/auth/register?error=${errorMsg}`);
      } else if (req.path === "/reset-password") {
        const token = req.body.token || req.query.token || "";
        return res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=${errorMsg}`);
      } else if (req.path === "/resend-verification") {
        return res.redirect(`/auth/login?error=${errorMsg}`);
      } else {
        return res.redirect(`/auth/login?error=${errorMsg}`);
      }
    }
    // For API requests, send JSON response
    res.status(options.statusCode).send(options.message);
  }
});

module.exports = {
  authLimiter
};
