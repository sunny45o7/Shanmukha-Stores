const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/',
    method: 'GET',
    timeout: 5000
};

console.log('🧪 Running Homepage Health Check...');

const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        const isOk = res.statusCode === 200;
        const hasHeading = data.includes('Shanmukha');
        
        if (isOk && hasHeading) {
            console.log('✅ PASS: Homepage is stable [200 OK]');
            process.exit(0);
        } else {
            console.error('❌ FAIL: Homepage check failed!');
            console.error(`- Status: ${res.statusCode} (Expected 200)`);
            console.error(`- Heading check: ${hasHeading ? 'Found' : 'NOT FOUND'}`);
            process.exit(1);
        }
    });
});

req.on('error', (err) => {
    console.error('❌ Error connecting to server:', err.message);
    process.exit(1);
});

req.on('timeout', () => {
    console.error('❌ Request timed out');
    req.destroy();
    process.exit(1);
});

req.end();
