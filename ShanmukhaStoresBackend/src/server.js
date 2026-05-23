const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./config/db'); // connect database

const authRoutes = require('./routes/authRoutes'); // ✅ Move to top

const app = express();

app.use(cors());
app.use(express.json()); // ✅ Only once

app.get('/', (req, res) => {
    res.json({
        message: "Shanmukha Stores Backend Running 🚀"
    });
});

app.use('/api/auth', authRoutes); // ✅ Before app.listen()

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});