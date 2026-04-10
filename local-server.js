const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const PORT = 8899;

const MIME = {
  'html': 'text/html; charset=utf-8',
  'css': 'text/css',
  'js': 'application/javascript',
  'json': 'application/json',
  'png': 'image/png',
  'ico': 'image/x-icon'
};

http.createServer((req, res) => {
  // 去掉 query string（如 ?v=20260326b），本地不需要缓存破解参数
  const rawPath = req.url.split('?')[0];
  const urlPath = rawPath === '/' ? '/index.html' : rawPath;
  const filePath = path.join(ROOT, urlPath);
  try {
    const data = fs.readFileSync(filePath);
    const ext = filePath.split('.').pop();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(PORT, () => {
  console.log('SHEIN Dashboard running at http://localhost:' + PORT);
});
