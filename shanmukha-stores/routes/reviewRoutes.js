const express = require("express");
const router = express.Router({ mergeParams: true });
const pool = require("../config/db");
const attachUser = require("../middleware/authMiddleware");

// Helper function to insert a review or update it if the user already reviewed the product
router.post("/", async (req, res, next) => {
    try {
        const { productId } = req.params;
        const { rating, review_text } = req.body;

        // Require logged in user
        if (!req.session.user) {
            req.session.returnTo = `/products/${productId}#reviews`;
            return res.redirect("/auth/login");
        }

        const userId = req.session.user.id;
        const parsedRating = parseInt(rating, 10);

        // Validate rating
        if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
            return res.redirect(`/products/${productId}?error=Invalid+rating#reviews`);
        }

        // Upsert the review (User can only leave one review per product)
        await pool.query(
            `INSERT INTO reviews (user_id, product_id, rating, review_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET rating = EXCLUDED.rating, review_text = EXCLUDED.review_text, created_at = CURRENT_TIMESTAMP`,
            [userId, productId, parsedRating, review_text ? review_text.trim() : null]
        );

        res.redirect(`/products/${productId}?success=Review+submitted#reviews`);
    } catch (err) {
        console.error("Submit Review Error:", err.message);
        next(err);
    }
});

router.use((req, res) => {
    res.status(404).render("errors/404", {
        title: "Page Not Found",
        user: res.locals.user
    });
});

module.exports = router;
