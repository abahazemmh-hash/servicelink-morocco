const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Serve index.html
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    // Serve admin.html
    else if (req.url === '/admin.html') {
        fs.readFile(path.join(__dirname, 'admin.html'), (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Admin page not found');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    // Serve other static files
    else if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|ico)$/)) {
        const filePath = path.join(__dirname, req.url);
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
            } else {
                let contentType = 'text/plain';
                if (req.url.endsWith('.css')) contentType = 'text/css';
                if (req.url.endsWith('.js')) contentType = 'application/javascript';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        });
    }
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});