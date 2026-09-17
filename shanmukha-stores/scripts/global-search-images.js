const pool = require('../config/db');

async function globalSearch() {
    const filenames = [
        '1772532396138-119055563.png',
        '1772532396152-514150702.png',
        '1772532396161-17027688.png'
    ];

    console.log('🔍 Global Database Search for Large Files...');

    try {
        // Get all tables and columns
        const tablesRes = await pool.query(`
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND data_type IN ('text', 'character varying')
        `);

        for (const row of tablesRes.rows) {
            const { table_name, column_name } = row;
            
            for (const filename of filenames) {
                const searchRes = await pool.query(`
                    SELECT COUNT(*) FROM "${table_name}" 
                    WHERE "${column_name}" LIKE $1
                `, [`%${filename}%`]);

                const count = parseInt(searchRes.rows[0].count);
                if (count > 0) {
                    console.log(`✅ FOUND: ${filename} in [${table_name}.${column_name}] (${count} rows)`);
                }
            }
        }
        console.log('✨ Search complete.');
    } catch (err) {
        console.error('❌ Search failed:', err.message);
    } finally {
        await pool.end();
    }
}

globalSearch();
