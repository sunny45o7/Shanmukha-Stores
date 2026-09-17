const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.registerUser = async (req, res) => {
    try {
        const { full_name, email, password, phone } = req.body;

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await pool.query(
            `INSERT INTO users (full_name, email, password, phone)
             VALUES ($1, $2, $3, $4)
             RETURNING id, full_name, email`,
            [full_name, email, hashedPassword, phone]
        );

        res.status(201).json({
            message: "User registered successfully",
            user: newUser.rows[0]
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};