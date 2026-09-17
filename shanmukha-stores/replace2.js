const fs = require('fs');
const file = 'views/admin/_header.ejs';
let content = fs.readFileSync(file, 'utf8');

// The HTML is formatted across multiple lines in some cases, like:
// <span
//   class="icon">O</span>

content = content.replace(/<span[^>]*class="icon"[^>]*>[\s\S]*?<\/span>/g, '');

fs.writeFileSync(file, content);
