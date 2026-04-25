const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./database');

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Serve main HTML file
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading app');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    
    // Serve admin HTML file
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
    
    // ==================== GIGS ENDPOINTS ====================
    
    // GET all gigs
    else if (req.url === '/api/gigs' && req.method === 'GET') {
        db.all('SELECT * FROM gigs ORDER BY created_at DESC', (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            }
        });
    }
    
    // POST create gig
    else if (req.url === '/api/gigs' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const gig = JSON.parse(body);
                const stmt = db.prepare(`
                    INSERT INTO gigs (id, title, category, urgency, description, status, household_id, household_name, created_at, completed_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                stmt.run(
                    gig.id, gig.title, gig.category, gig.urgency,
                    gig.description, 'open', gig.household_id,
                    gig.household_name, gig.created_at, '[]'
                );
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    // DELETE a gig (admin)
    else if (req.url.match(/^\/api\/gigs\/.+\/delete$/) && req.method === 'DELETE') {
        const gigId = req.url.split('/')[3];
        db.run('DELETE FROM gigs WHERE id = ?', [gigId], (err) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            }
        });
    }
    
    // POST accept gig
    else if (req.url.match(/^\/api\/gigs\/.+\/accept$/) && req.method === 'POST') {
        const gigId = req.url.split('/')[3];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { professional_id, professional_name } = JSON.parse(body);
                
                db.get('SELECT balance FROM users WHERE id = ?', [professional_id], (err, user) => {
                    if (err || !user) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'User not found' }));
                        return;
                    }
                    
                    if (user.balance < 10) {
                        res.writeHead(402, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Insufficient balance' }));
                        return;
                    }
                    
                    db.run(`
                        UPDATE gigs 
                        SET status = 'accepted', professional_id = ?, professional_name = ?
                        WHERE id = ?
                    `, [professional_id, professional_name, gigId]);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    // POST complete gig - FIXED WITH PROPER COMMISSION
    else if (req.url.match(/^\/api\/gigs\/.+\/complete$/) && req.method === 'POST') {
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
                    
                    // Get current completed_by array
                    let completedBy = [];
                    if (gig.completed_by && gig.completed_by !== '[]') {
                        try {
                            completedBy = JSON.parse(gig.completed_by);
                        } catch(e) {
                            completedBy = [];
                        }
                    }
                    
                    // Add current user if not already there
                    if (!completedBy.includes(user_id)) {
                        completedBy.push(user_id);
                    }
                    
                    console.log(`Gig ${gigId} - Completed by: ${completedBy.join(', ')}`);
                    
                    if (completedBy.length === 2) {
                        // BOTH parties completed - deduct commission
                        console.log(`Deducting MAD 10 from professional: ${gig.professional_id}`);
                        
                        // Deduct commission
                        db.run('UPDATE users SET balance = balance - 10 WHERE id = ?', [gig.professional_id]);
                        
                        // Mark gig as completed
                        db.run(`
                            UPDATE gigs 
                            SET status = 'completed', completed_by = ?, completed_at = ?
                            WHERE id = ?
                        `, [JSON.stringify(completedBy), Date.now(), gigId]);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, completed: true }));
                    } else {
                        // Only one party completed
                        db.run(`
                            UPDATE gigs 
                            SET completed_by = ?
                            WHERE id = ?
                        `, [JSON.stringify(completedBy), gigId]);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, completed: false }));
                    }
                });
            } catch (err) {
                console.error('Complete endpoint error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    // ==================== USER ENDPOINTS ====================
    
    // GET all users (admin)
    else if (req.url === '/api/users/all' && req.method === 'GET') {
        db.all('SELECT id, name, phone, role, balance, created_at FROM users ORDER BY created_at DESC', (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            }
        });
    }
    
    // POST create/update user
    else if (req.url === '/api/users' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const user = JSON.parse(body);
                db.run(`
                    INSERT OR REPLACE INTO users (id, name, phone, role, bio, skills, balance, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [user.id, user.name, user.phone, user.role, user.bio || '', user.skills || '', user.balance || 0, user.created_at]);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, user: user }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    // GET user by phone
    else if (req.url.startsWith('/api/users?phone=') && req.method === 'GET') {
        const phone = req.url.split('=')[1];
        db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, row) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(row || null));
            }
        });
    }
    
    // DELETE a user (admin)
    else if (req.url.match(/^\/api\/users\/.+\/delete$/) && req.method === 'DELETE') {
        const userId = req.url.split('/')[3];
        db.run('DELETE FROM users WHERE id = ?', [userId], (err) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            }
        });
    }
    
    // ==================== WALLET ENDPOINTS ====================
    
    // POST fund wallet (demo)
    else if (req.url === '/api/wallet/fund' && req.method === 'POST') {
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
    }
    
    // ==================== CASHPLUS ENDPOINTS ====================
    
    // POST request CashPlus deposit
    else if (req.url === '/api/cashplus/request' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, amount } = JSON.parse(body);
                const reference = 'CP' + Date.now() + Math.random().toString(36).substr(2, 6).toUpperCase();
                const depositId = 'dep_' + Date.now();
                
                db.run(`
                    INSERT INTO cashplus_deposits (id, user_id, amount, reference, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [depositId, user_id, amount, reference, 'pending', Date.now()]);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    reference: reference,
                    instructions: `Transfer MAD ${amount} to CashPlus account: 123-456789-01 (ServiceLink Morocco). Use reference: ${reference}`
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    // POST verify CashPlus deposit (admin)
    else if (req.url === '/api/cashplus/verify' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { reference } = JSON.parse(body);
                
                db.get('SELECT * FROM cashplus_deposits WHERE reference = ? AND status = "pending"', [reference], (err, deposit) => {
                    if (err || !deposit) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Deposit not found' }));
                        return;
                    }
                    
                    db.run('UPDATE cashplus_deposits SET status = "verified", verified_at = ? WHERE reference = ?', [Date.now(), reference]);
                    db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, amount: deposit.amount }));
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    // GET pending CashPlus deposits (admin)
    else if (req.url === '/api/cashplus/pending' && req.method === 'GET') {
        db.all('SELECT * FROM cashplus_deposits WHERE status = "pending" ORDER BY created_at DESC', (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            }
        });
    }
    
    // ==================== STATS ENDPOINTS ====================
    
    // GET platform stats (admin)
    else if (req.url === '/api/stats' && req.method === 'GET') {
        const stats = { totalUsers: 0, totalGigs: 0, openGigs: 0, activeGigs: 0, completedGigs: 0, totalWalletBalance: 0 };
        
        db.get('SELECT COUNT(*) as total FROM users', (err, row) => { stats.totalUsers = row ? row.total : 0; });
        db.get('SELECT COUNT(*) as total FROM gigs', (err, row) => { stats.totalGigs = row ? row.total : 0; });
        db.get('SELECT COUNT(*) as total FROM gigs WHERE status = "open"', (err, row) => { stats.openGigs = row ? row.total : 0; });
        db.get('SELECT COUNT(*) as total FROM gigs WHERE status = "accepted"', (err, row) => { stats.activeGigs = row ? row.total : 0; });
        db.get('SELECT COUNT(*) as total FROM gigs WHERE status = "completed"', (err, row) => { stats.completedGigs = row ? row.total : 0; });
        db.get('SELECT SUM(balance) as total FROM users WHERE role = "professional"', (err, row) => { stats.totalWalletBalance = (row && row.total) ? row.total : 0; });
        
        setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        }, 200);
    }
    
    // ==================== MESSAGES ENDPOINTS ====================
    
    // GET messages
    else if (req.url.match(/^\/api\/gigs\/.+\/messages$/) && req.method === 'GET') {
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
    }
    
    // POST send message
    else if (req.url.match(/^\/api\/gigs\/.+\/messages$/) && req.method === 'POST') {
        const gigId = req.url.split('/')[3];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { sender_id, sender_name, text } = JSON.parse(body);
                const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                db.run(`
                    INSERT INTO messages (id, gig_id, sender_id, sender_name, text, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [messageId, gigId, sender_id, sender_name, text, Date.now()]);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    // ==================== REPORTS ENDPOINTS ====================
    
    // GET all reports (admin)
    else if (req.url === '/api/reports' && req.method === 'GET') {
        db.all('SELECT * FROM reports ORDER BY created_at DESC', (err, rows) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            }
        });
    }
    
    // POST create report
    else if (req.url === '/api/reports' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const report = JSON.parse(body);
                db.run(`
                    INSERT INTO reports (id, reporter_id, gig_id, reason, details, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [report.id, report.reporter_id, report.gig_id, report.reason, report.details || '', 'pending', Date.now()]);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    }
    
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const port = 3000;
server.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    console.log(`✅ Admin dashboard at http://localhost:${port}/admin.html`);
});