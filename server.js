const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const twilio = require('twilio');

// ==================== TWILIO CONFIG ====================
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    console.error('❌ Missing Twilio credentials in environment variables');
}

const client = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

// ==================== DATABASE ====================
const db = new sqlite3.Database('servicelink.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        is_verified INTEGER DEFAULT 0,
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

    console.log('✅ Database ready with password support');
});

// ==================== TWILIO HELPER FUNCTIONS ====================
async function sendVerificationCode(phone) {
    if (!client) {
        console.log(`⚠️ [NO TWILIO] Would send code to ${phone}`);
        return { success: true, testMode: true };
    }
    try {
        const verification = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
            .verifications.create({ to: phone, channel: 'sms' });
        return { success: true, status: verification.status };
    } catch (error) {
        console.error('Twilio send error:', error);
        return { success: false, error: error.message };
    }
}

async function checkVerificationCode(phone, code) {
    if (!client) {
        return { success: code && code.length === 6 };
    }
    try {
        const verificationCheck = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
            .verificationChecks.create({ to: phone, code: code });
        return { success: verificationCheck.status === 'approved' };
    } catch (error) {
        console.error('Twilio verify error:', error);
        return { success: false, error: error.message };
    }
}

// ==================== SERVER ====================
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

    // ==================== SERVE HTML ====================
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

    // ==================== AUTH ENDPOINTS ====================
    
    if (req.url === '/api/send-code' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { phone } = JSON.parse(body);
                const result = await sendVerificationCode(phone);
                if (result.success) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, testMode: result.testMode, message: 'Code sent' }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: result.error }));
                }
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url === '/api/verify-register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { phone, code, name, password, role } = JSON.parse(body);
                const verification = await checkVerificationCode(phone, code);
                if (!verification.success) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid or expired code' }));
                    return;
                }
                const password_hash = await bcrypt.hash(password, 10);
                const userId = 'user_' + Date.now();
                db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, existing) => {
                    if (existing) {
                        db.run(`UPDATE users SET id = ?, name = ?, password_hash = ?, role = ?, is_verified = 1 WHERE phone = ?`,
                            [userId, name, password_hash, role, phone]);
                    } else {
                        db.run(`INSERT INTO users (id, name, phone, password_hash, role, is_verified, created_at, balance) 
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [userId, name, phone, password_hash, role, 1, Date.now(), role === 'professional' ? 0 : 0]);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, user: { id: userId, name, phone, role } }));
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { phone, password } = JSON.parse(body);
                db.get('SELECT * FROM users WHERE phone = ? AND is_verified = 1', [phone], async (err, user) => {
                    if (err || !user) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid phone or password' }));
                        return;
                    }
                    const match = await bcrypt.compare(password, user.password_hash);
                    if (!match) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid phone or password' }));
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, balance: user.balance } }));
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url.startsWith('/api/user-exists?phone=') && req.method === 'GET') {
        const phone = decodeURIComponent(req.url.split('=')[1]);
        db.get('SELECT id, name, phone, role, is_verified FROM users WHERE phone = ?', [phone], (err, user) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ exists: !!user, isVerified: user?.is_verified === 1, user: user || null }));
            }
        });
        return;
    }
    
    if (req.url === '/api/reset-password' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { phone, newPassword } = JSON.parse(body);
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                db.run('UPDATE users SET password_hash = ? WHERE phone = ?', [hashedPassword, phone]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // ==================== GIGS ENDPOINTS ====================
    
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

    if (req.url.match(/^\/api\/gigs\/.+\/complete$/) && req.method === 'POST') {
        const gigId = req.url.split('/')[3];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id } = JSON.parse(body);
                db.get('SELECT * FROM gigs WHERE id = ?', [gigId], (err, gig) => {
                    if (err || !gig) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Gig not found' }));
                        return;
                    }
                    let completedBy = [];
                    if (gig.completed_by && gig.completed_by !== '[]') {
                        try { completedBy = JSON.parse(gig.completed_by); } catch(e) { completedBy = []; }
                    }
                    if (!completedBy.includes(user_id)) completedBy.push(user_id);
                    if (completedBy.length === 2) {
                        db.run('UPDATE users SET balance = balance - 10 WHERE id = ?', [gig.professional_id]);
                        db.run(`UPDATE gigs SET status = 'completed', completed_by = ?, completed_at = ? WHERE id = ?`,
                            [JSON.stringify(completedBy), Date.now(), gigId]);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, completed: true }));
                    } else {
                        db.run(`UPDATE gigs SET completed_by = ? WHERE id = ?`, [JSON.stringify(completedBy), gigId]);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, completed: false }));
                    }
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // ==================== WALLET ENDPOINTS ====================
    
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

    // ==================== MESSAGES ENDPOINTS ====================
    
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
        // ==================== LOCATION ENDPOINTS ====================
    
    // Update user location
    if (req.url === '/api/users/location' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, lat, lng } = JSON.parse(body);
                db.run('UPDATE users SET lat = ?, lng = ?, location_updated_at = ? WHERE id = ?',
                    [lat, lng, Date.now(), user_id]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    // Get gigs with distance calculation (for professionals)
    if (req.url === '/api/gigs/nearby' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { lat, lng, maxDistance = 50 } = JSON.parse(body); // maxDistance in km
                
                // Haversine formula to calculate distance
                db.all(`
                    SELECT *, 
                        (6371 * acos(
                            cos(radians(?)) * cos(radians(lat)) * 
                            cos(radians(lng) - radians(?)) + 
                            sin(radians(?)) * sin(radians(lat))
                        )) AS distance
                    FROM gigs 
                    WHERE status = 'open' AND lat IS NOT NULL AND lng IS NOT NULL
                    HAVING distance < ?
                    ORDER BY distance ASC
                `, [lat, lng, lat, maxDistance], (err, rows) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(rows));
                    }
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    // Get nearby professionals for a household (when viewing applications)
    if (req.url === '/api/professionals/nearby' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { lat, lng, maxDistance = 50 } = JSON.parse(body);
                
                db.all(`
                    SELECT id, name, phone, role, bio, skills, balance,
                        (6371 * acos(
                            cos(radians(?)) * cos(radians(lat)) * 
                            cos(radians(lng) - radians(?)) + 
                            sin(radians(?)) * sin(radians(lat))
                        )) AS distance
                    FROM users 
                    WHERE role = 'professional' AND lat IS NOT NULL AND lng IS NOT NULL
                    HAVING distance < ?
                    ORDER BY distance ASC
                `, [lat, lng, lat, maxDistance], (err, rows) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(rows));
                    }
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // 404
    res.writeHead(404);
    res.end('Not found');
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`✅ Reset password endpoint ready`);
    if (client) console.log(`✅ Twilio Verify active`);
    else console.log(`⚠️ Twilio not configured (test mode active)`);
});