const fs = require('fs');
const file = 'views/admin/_header.ejs';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/<span class="icon">[A-Z]<\/span>/g, '');
fs.writeFileSync(file, content);
