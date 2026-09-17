const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function research() {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    const threshold = 500 * 1024; // 500KB
    
    function getFiles(dir, fileList = []) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const name = path.join(dir, file);
            if (fs.statSync(name).isDirectory()) {
                if (file !== '_backup') getFiles(name, fileList);
            } else {
                if (['.png', '.jpg', '.jpeg'].includes(path.extname(name).toLowerCase())) {
                    if (fs.statSync(name).size > threshold) {
                        fileList.push(name);
                    }
                }
            }
        });
        return fileList;
    }

    const largeFiles = getFiles(uploadDir);
    console.log(`Found ${largeFiles.length} files > 500KB.`);

    for (const fullPath of largeFiles) {
        const relativePath = '/' + path.relative(path.join(__dirname, '..', 'public'), fullPath).replace(/\\/g, '/');
        const sizeKB = (fs.statSync(fullPath).size / 1024).toFixed(2);
        
        const res = await pool.query(
            `SELECT 'product' as type, id, name FROM products WHERE image = $1 
             UNION SELECT 'gallery' as type, product_id as id, '' as name FROM product_images WHERE image_url = $1
             UNION SELECT 'category' as type, id, name FROM categories WHERE image = $1
             UNION SELECT 'banner' as type, id, title as name FROM banners WHERE image = $1
             UNION SELECT 'popup_ad' as type, id, title as name FROM popup_ads WHERE image_url = $1
             UNION SELECT 'collaboration' as type, id, name FROM collaborations WHERE logo_url = $1`,
            [relativePath]
        );
        
        console.log(`- ${relativePath} (${sizeKB} KB) -> Refs: ${res.rows.length}`);
        res.rows.forEach(r => console.log(`  [${r.type}] ID: ${r.id} ${r.name}`));
    }
    
    await pool.end();
}

research();
