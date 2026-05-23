const http = require('http');
http.get('http://localhost:3000', (res) => {
  let data = '';
  console.log('Status Code:', res.statusCode);
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    require('fs').writeFileSync('rendered.html', data);
    console.log('Saved to rendered.html');
  });
}).on('error', err => console.log('Error: ', err.message));
