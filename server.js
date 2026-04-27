const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Initialize database
const db = new sqlite3.Database('servicelink.db');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        bio TEXT,
        skills TEXT,
        balance INTEGER DEFAULT 0,
        created_at INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS gigs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        urgency TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        household_id TEXT NOT NULL,
        household_name TEXT NOT NULL,
        professional_id TEXT,
        professional_name TEXT,
        completed_by TEXT DEFAULT '[]',
        created_at INTEGER,
        completed_at INTEGER,
        rating INTEGER,
        review TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        gig_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS cashplus_deposits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reference TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER,
        verified_at INTEGER
    )`);

    console.log('✅ Database ready');
});

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    console.log(`📡 ${req.method} ${req.url}`);

    // Serve HTML files
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
        return;
    }
    
    if (req.url === '/admin.html') {
        fs.readFile(path.join(__dirname, 'admin.html'), (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Admin page not found');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
        return;
    }

    // ==================== API ROUTES ====================

    // GET all gigs
    if (req.url === '/api/gigs' && req.method === 'GET') {
        db.all('SELECT * FROM gigs ORDER BY created_at DESC', (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            }
        });
        return;
    }

    // POST create gig
    if (req.url === '/api/gigs' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const gig = JSON.parse(body);
                db.run(`INSERT INTO gigs (id, title, category, urgency, description, status, household_id, household_name, created_at, completed_by) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [gig.id, gig.title, gig.category, gig.urgency, gig.description, 'open', gig.household_id, gig.household_name, gig.created_at, '[]']);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // POST create user
    if (req.url === '/api/users' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const user = JSON.parse(body);
                db.run(`INSERT OR REPLACE INTO users (id, name, phone, role, bio, skills, balance, created_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user.id, user.name, user.phone, user.role, user.bio || '', user.skills || '', user.balance || 0, user.created_at]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, user: user }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // GET user by phone
    if (req.url.startsWith('/api/users?phone=') && req.method === 'GET') {
        const phone = decodeURIComponent(req.url.split('=')[1]);
        db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, row) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(row || null));
            }
        });
        return;
    }

    // POST accept gig
    if (req.url.match(/^\/api\/gigs\/.+\/accept$/) && req.method === 'POST') {
        const gigId = req.url.split('/')[3];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { professional_id, professional_name } = JSON.parse(body);
                db.run(`UPDATE gigs SET status = 'accepted', professional_id = ?, professional_name = ? WHERE id = ?`,
                    [professional_id, professional_name, gigId]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // POST fund wallet (demo)
    if (req.url === '/api/wallet/fund' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, amount } = JSON.parse(body);
                db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, user_id]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // GET all users (admin)
    if (req.url === '/api/users/all' && req.method === 'GET') {
        db.all('SELECT id, name, phone, role, balance, created_at FROM users ORDER BY created_at DESC', (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            }
        });
        return;
    }

    // GET messages
    if (req.url.match(/^\/api\/gigs\/.+\/messages$/) && req.method === 'GET') {
        const gigId = req.url.split('/')[3];
        db.all('SELECT * FROM messages WHERE gig_id = ? ORDER BY created_at ASC', [gigId], (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            }
        });
        return;
    }

    // POST send message
    if (req.url.match(/^\/api\/gigs\/.+\/messages$/) && req.method === 'POST') {
        const gigId = req.url.split('/')[3];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { sender_id, sender_name, text } = JSON.parse(body);
                const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                db.run(`INSERT INTO messages (id, gig_id, sender_id, sender_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                    [messageId, gigId, sender_id, sender_name, text, Date.now()]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // 404 for anything else
    res.writeHead(404);
    res.end('Not found');
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`✅ API available at /api/gigs`);
});