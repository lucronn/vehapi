// Post-build script: Injects Eruda mobile DevTools into dist/index.html
const fs = require('fs');
const path = require('path');

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(distIndex)) {
    console.log('[inject-eruda] dist/index.html not found, skipping.');
    process.exit(0);
}

let html = fs.readFileSync(distIndex, 'utf8');

const erudaSnippet = '<script src="https://cdn.jsdelivr.net/npm/eruda@3.0.1/eruda.min.js"></script><script>eruda.init();</script>';

if (html.includes('eruda')) {
    console.log('[inject-eruda] Eruda already present, skipping.');
    process.exit(0);
}

html = html.replace(/<body([^>]*)>/, `<body$1>${erudaSnippet}`);

fs.writeFileSync(distIndex, html, 'utf8');
console.log('[inject-eruda] ✅ Eruda injected into dist/index.html');
