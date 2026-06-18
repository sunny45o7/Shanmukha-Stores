const fs = require('fs');
const path = require('path');
const pool = require('./config/db');

async function fixDB() {
    console.log('Fixing DB...');
    try {
        const queries = [
            { table: 'products', column: 'image' },
            { table: 'product_images', column: 'image_url' },
            { table: 'categories', column: 'image' },
            { table: 'banners', column: 'image' },
            { table: 'users', column: 'profile_image' },
            { table: 'popup_ads', column: 'image_url' },
            { table: 'collections', column: 'image' }
        ];

        for (const {table, column} of queries) {
            const res = await pool.query(`SELECT id, ${column} AS url FROM ${table} WHERE ${column} IS NOT NULL`);
            for (const row of res.rows) {
                if (!row.url) continue;
                if (!row.url.endsWith('.webp') && !row.url.startsWith('http')) {
                    const relativePath = row.url.trim();
                    const basePath = relativePath.substring(0, relativePath.lastIndexOf('.'));
                    const webpPath = basePath + '.webp';
                    
                    const fullWebpPath = path.join(__dirname, 'public', webpPath);
                    if (fs.existsSync(fullWebpPath)) {
                        console.log(`Fixing ${row.url} -> ${webpPath} in ${table}`);
                        await pool.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [webpPath, row.id]);
                    }
                }
            }
        }
        console.log('DB fixed.');
    } catch(err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
fixDB();
