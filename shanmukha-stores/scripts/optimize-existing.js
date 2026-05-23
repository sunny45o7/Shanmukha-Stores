const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pool = require('../config/db');

// Directories
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
const productUploadDir = path.join(uploadDir, 'products');
const backupDir = path.join(uploadDir, '_backup');

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

async function optimizeImages() {
    console.log('🚀 Starting bulk image optimization...');

    try {
        // 1. Get all products and gallery images from DB
        const products = await pool.query('SELECT id, image FROM products WHERE image IS NOT NULL');
        const gallery = await pool.query('SELECT id, image_url FROM product_images WHERE image_url IS NOT NULL');

        const allImages = [
            ...products.rows.map(p => ({ id: p.id, type: 'product', url: p.image })),
            ...gallery.rows.map(g => ({ id: g.id, type: 'gallery', url: g.image_url }))
        ];

        console.log(`Found ${allImages.length} database entries to process.`);

        for (const item of allImages) {
            const relativePath = item.url;
            // Map /uploads/products/xyz.png to the actual path
            const fullPath = path.join(__dirname, '..', 'public', relativePath);

            if (!fs.existsSync(fullPath)) {
                console.warn(`⚠️ File not found: ${fullPath}`);
                continue;
            }

            if (path.extname(fullPath).toLowerCase() === '.webp') {
                continue; // Skip if already WebP
            }

            console.log(`Optimizing: ${relativePath}`);

            const dirName = path.dirname(fullPath);
            const baseName = path.basename(fullPath, path.extname(fullPath));
            const newRelativePath = path.join(path.dirname(relativePath), `${baseName}.webp`).replace(/\\/g, '/');
            const newFullPath = path.join(dirName, `${baseName}.webp`);

            try {
                // Convert to WebP
                await sharp(fullPath)
                    .webp({ quality: 80 })
                    .toFile(newFullPath);

                // Update Database
                if (item.type === 'product') {
                    await pool.query('UPDATE products SET image = $1 WHERE id = $2', [newRelativePath, item.id]);
                } else {
                    await pool.query('UPDATE product_images SET image_url = $1 WHERE id = $2', [newRelativePath, item.id]);
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
