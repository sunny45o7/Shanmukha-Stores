const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pool = require('../config/db');

// Directories
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
const backupDir = path.join(uploadDir, '_backup');

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

async function optimizeImages() {
    console.log('🚀 Starting bulk image optimization...');

    try {
        // 1. Get all images from DB
        const queries = {
            products: 'SELECT id, image AS url FROM products WHERE image IS NOT NULL',
            product_images: 'SELECT id, image_url AS url FROM product_images WHERE image_url IS NOT NULL',
            categories: 'SELECT id, image AS url FROM categories WHERE image IS NOT NULL',
            banners: 'SELECT id, image AS url FROM banners WHERE image IS NOT NULL',
            users: 'SELECT id, profile_image AS url FROM users WHERE profile_image IS NOT NULL',
            popup_ads: 'SELECT id, image_url AS url FROM popup_ads WHERE image_url IS NOT NULL',
            collections: 'SELECT id, image AS url FROM collections WHERE image IS NOT NULL'
        };

        let allImages = [];
        for (const [table, query] of Object.entries(queries)) {
            try {
                const res = await pool.query(query);
                res.rows.forEach(row => {
                    if (row.url) {
                        allImages.push({ id: row.id, type: table, url: row.url });
                    }
                });
            } catch (err) {
                console.warn(`⚠️ Could not query table ${table}: ${err.message}`);
            }
        }

        console.log(`Found ${allImages.length} database entries to process.`);

        for (const item of allImages) {
            let relativePath = item.url.trim();
            // Only process local relative paths starting with '/uploads/'
            if (!relativePath.startsWith('/uploads/')) {
                continue;
            }

            // Map /uploads/xyz.png to the actual path
            const fullPath = path.join(__dirname, '..', 'public', relativePath);

            if (!fs.existsSync(fullPath)) {
                console.warn(`⚠️ File not found: ${fullPath}`);
                continue;
            }

            if (path.extname(fullPath).toLowerCase() === '.webp') {
                continue; // Skip if already WebP
            }

            console.log(`Optimizing: ${relativePath} [${item.type}]`);

            const dirName = path.dirname(fullPath);
            const baseName = path.basename(fullPath, path.extname(fullPath));
            const newRelativePath = relativePath.split('/').slice(0, -1).join('/') + '/' + `${baseName}.webp`;
            const newFullPath = path.join(dirName, `${baseName}.webp`);

            try {
                // Convert to WebP
                await sharp(fullPath)
                    .webp({ quality: 80 })
                    .toFile(newFullPath);

                // Update Database
                switch (item.type) {
                    case 'products':
                        await pool.query('UPDATE products SET image = $1 WHERE id = $2', [newRelativePath, item.id]);
                        break;
                    case 'product_images':
                        await pool.query('UPDATE product_images SET image_url = $1 WHERE id = $2', [newRelativePath, item.id]);
                        break;
                    case 'categories':
                        await pool.query('UPDATE categories SET image = $1 WHERE id = $2', [newRelativePath, item.id]);
                        break;
                    case 'banners':
                        await pool.query('UPDATE banners SET image = $1 WHERE id = $2', [newRelativePath, item.id]);
                        break;
                    case 'users':
                        await pool.query('UPDATE users SET profile_image = $1 WHERE id = $2', [newRelativePath, item.id]);
                        break;
                    case 'popup_ads':
                        await pool.query('UPDATE popup_ads SET image_url = $1 WHERE id = $2', [newRelativePath, item.id]);
                        break;
                    case 'collections':
                        await pool.query('UPDATE collections SET image = $1 WHERE id = $2', [newRelativePath, item.id]);
                        break;
                }

                // Move original to backup
                const backupPath = path.join(backupDir, path.basename(fullPath));
                fs.renameSync(fullPath, backupPath);

                console.log(`✅ Success: ${newRelativePath}`);
            } catch (err) {
                console.error(`❌ Error processing ${fullPath}:`, err.message);
            }
        }

        console.log('✨ Image optimization complete!');
    } catch (err) {
        console.error('💥 Script failed:', err);
    } finally {
        await pool.end();
    }
}

optimizeImages();
