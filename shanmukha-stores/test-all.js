const http = require('http');

const baseURL = 'http://127.0.0.1:3000';

const tests = [
    { name: 'PROD-01: View Homepage / Catalog', path: '/', method: 'GET', expectedStatus: 200 },
    { name: 'AUTH-03: View Login Page', path: '/auth/login', method: 'GET', expectedStatus: 200 },
    { name: 'AUTH-01: View Register Page', path: '/auth/register', method: 'GET', expectedStatus: 200 },
    { name: 'CART-01: View Cart (Unauthenticated)', path: '/cart', method: 'GET', expectedStatus: 200 },
    { name: 'SEC-01: Unauthorized Admin Access', path: '/admin/dashboard', method: 'GET', expectedStatus: 403 }, // Expecting 403 or redirect (302)
    { name: 'ERR-404: Non-existent Page', path: '/this-page-does-not-exist', method: 'GET', expectedStatus: 404 },
];

let results = [];

async function runTest(test) {
    return new Promise((resolve) => {
        const req = http.request(`${baseURL}${test.path}`, { method: test.method }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let actualStatus = res.statusCode;
                // If it redirects (302) away from admin dashboard, we consider unauthorized access prevented.
                let passed = actualStatus === test.expectedStatus || (test.name.includes('Unauthorized Admin') && actualStatus === 302);
                
                let resultObj = {
                    Test_Scenario: test.name,
                    Expected: test.expectedStatus,
                    Actual: actualStatus,
                    Status: passed ? 'Pass' : 'Fail',
                    Path: test.path
                };
                console.log(`${passed ? '✅' : '❌'} ${test.name} - Expected: ${test.expectedStatus}, Actual: ${actualStatus}`);
                results.push(resultObj);
                resolve();
            });
        });
        
        req.on('error', (err) => {
            console.log(`❌ ${test.name} - Network Error: ${err.message}`);
            results.push({
                Test_Scenario: test.name,
                Expected: test.expectedStatus,
                Actual: 'Network Error',
                Status: 'Fail',
                Path: test.path
            });
            resolve();
        });
        
        req.end();
    });
}

async function runAll() {
    console.log('Starting Test Suite...\n');
    for (const test of tests) {
        await runTest(test);
    }
    console.log('\nAll tests completed.');
    console.log(JSON.stringify(results, null, 2));
}

runAll();
