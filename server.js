const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const twilio = require('twilio');

// ==================== ENVIRONMENT VARIABLES ====================
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    console.error('❌ Missing Twilio credentials. Set them in Railway environment variables.');
    process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ==================== DATABASE ====================
const db = new sqlite3.Database('servicelink.db');

db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, is_verified INTEGER DEFAULT 0, role TEXT NOT NULL, bio TEXT, skills TEXT, balance INTEGER DEFAULT 0, profile_picture TEXT, lat REAL, lng REAL, location_updated_at INTEGER, profile_completed INTEGER DEFAULT 0, created_at INTEGER)`);
    
    // Gigs table
    db.run(`CREATE TABLE IF NOT EXISTS gigs (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, urgency TEXT NOT NULL, description TEXT NOT NULL, status TEXT DEFAULT 'open', household_id TEXT NOT NULL, household_name TEXT NOT NULL, professional_id TEXT, professional_name TEXT, completed_by TEXT DEFAULT '[]', address TEXT, lat REAL, lng REAL, created_at INTEGER, completed_at INTEGER, rating INTEGER, review TEXT)`);
    
    // Education table
    db.run(`CREATE TABLE IF NOT EXISTS education (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, degree TEXT NOT NULL, institution TEXT NOT NULL, year TEXT, created_at INTEGER)`);
    
    // Work Experience table
    db.run(`CREATE TABLE IF NOT EXISTS work_experience (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, company TEXT NOT NULL, start_year TEXT, end_year TEXT, description TEXT, created_at INTEGER)`);
    
    // Certifications table
    db.run(`CREATE TABLE IF NOT EXISTS certifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, issuer TEXT NOT NULL, year TEXT, document_url TEXT, created_at INTEGER)`);
    
    // Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, gig_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER)`);
    
    // Gig applications table
    db.run(`CREATE TABLE IF NOT EXISTS gig_applications (id TEXT PRIMARY KEY, gig_id TEXT NOT NULL, professional_id TEXT NOT NULL, bid_amount INTEGER, message TEXT, status TEXT DEFAULT 'pending', created_at INTEGER)`);
    
    // Reports table
    db.run(`CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, gig_id TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, status TEXT DEFAULT 'pending', created_at INTEGER)`);
    
    // Admins table
    db.run(`CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER)`);
    
    console.log('✅ Production database ready');

    // ==================== AUTO-CREATE ADMIN USER ====================
    db.get('SELECT * FROM admins LIMIT 1', [], (err, admin) => {
        if (err) {
            console.error('Error checking for admin:', err);
            return;
        }
        if (!admin) {
            console.log('⚠️ No admin found. Creating default admin...');
            bcrypt.hash('admin123', 10).then(hash => {
                db.run(`INSERT OR IGNORE INTO admins (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
                    ['admin_1', 'admin', hash, Date.now()], (insertErr) => {
                        if (insertErr) {
                            console.error('Error creating admin:', insertErr);
                        } else {
                            console.log('✅ Default admin created!');
                            console.log('   Username: admin');
                            console.log('   Password: admin123');
                            console.log('   ⚠️ Please change this password after first login!');
                        }
                    });
            }).catch(err => console.error('Hash error:', err));
        } else {
            console.log('✅ Admin user already exists');
        }
    });
});

// ==================== TWILIO HELPER FUNCTIONS ====================
async function sendVerificationCode(phone) {
    try {
        const verification = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
            .verifications.create({ to: phone, channel: 'sms' });
        return { success: true };
    } catch (error) {
        console.error('Twilio send error:', error);
        return { success: false, error: error.message };
    }
}

async function checkVerificationCode(phone, code) {
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

    // ==================== SERVE HTML FILES ====================
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) { res.writeHead(500); res.end('Error loading app'); }
            else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data); }
        });
        return;
    }
    
    if (req.url === '/login.html') {
        fs.readFile(path.join(__dirname, 'login.html'), (err, data) => {
            if (err) { res.writeHead(404); res.end('Login page not found'); }
            else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data); }
        });
        return;
    }

    if (req.url === '/admin.html') {
        fs.readFile(path.join(__dirname, 'admin.html'), (err, data) => {
            if (err) { res.writeHead(404); res.end('Admin page not found'); }
            else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data); }
        });
        return;
    }

    // ==================== ADMIN AUTH ====================
    if (req.url === '/api/admin/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                db.get('SELECT * FROM admins WHERE username = ?', [username], async (err, admin) => {
                    if (err || !admin) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid credentials' }));
                        return;
                    }
                    const match = await bcrypt.compare(password, admin.password_hash);
                    if (!match) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid credentials' }));
                        return;
                    }
                    const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, token }));
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (req.url === '/api/admin/verify' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { token } = JSON.parse(body);
                if (token && token.length > 10) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: true }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: false }));
                }
            } catch (err) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid: false }));
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
                    res.end(JSON.stringify({ success: true }));
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

    // ==================== USER ENDPOINTS ====================
    
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
    
    if (req.url === '/api/users/location' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, lat, lng } = JSON.parse(body);
                db.run('UPDATE users SET lat = ?, lng = ?, location_updated_at = ? WHERE id = ?', [lat, lng, Date.now(), user_id]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
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
    
    if (req.url === '/api/update-profile' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, bio, skills, profile_picture, profile_completed } = JSON.parse(body);
                db.run(`UPDATE users SET bio = ?, skills = ?, profile_picture = ?, profile_completed = ? WHERE id = ?`,
                    [bio || '', skills || '', profile_picture || '', profile_completed ? 1 : 0, user_id]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url === '/api/my-profile' && req.method === 'GET') {
        const userId = req.url.split('?')[1]?.split('=')[1];
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User ID required' }));
            return;
        }
        const profile = {};
        db.get('SELECT id, name, phone, bio, skills, profile_picture, profile_completed FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }
            profile.user = user;
            db.all('SELECT * FROM education WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, edu) => {
                profile.education = edu || [];
                db.all('SELECT * FROM work_experience WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, work) => {
                    profile.workExperience = work || [];
                    db.all('SELECT * FROM certifications WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, certs) => {
                        profile.certifications = certs || [];
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(profile));
                    });
                });
            });
        });
        return;
    }
    
    // ==================== GIG ENDPOINTS ====================
    
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
                db.run(`INSERT INTO gigs (id, title, category, urgency, description, status, household_id, household_name, created_at, completed_by, address, lat, lng) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [gig.id, gig.title, gig.category, gig.urgency, gig.description, 'open', gig.household_id, gig.household_name, gig.created_at, '[]', gig.address || '', gig.lat || null, gig.lng || null]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url.match(/^\/api\/gigs\/.+\/delete$/) && req.method === 'DELETE') {
        const gigId = req.url.split('/')[3];
        db.run('DELETE FROM gigs WHERE id = ?', [gigId]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
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
                    if (err || !gig) { res.writeHead(404); res.end(JSON.stringify({ error: 'Gig not found' })); return; }
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
    
    if (req.url === '/api/gigs/nearby' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { lat, lng, maxDistance = 50 } = JSON.parse(body);
                db.all(`
                    SELECT *, (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lng) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) AS distance
                    FROM gigs WHERE status = 'open' AND lat IS NOT NULL AND lng IS NOT NULL HAVING distance < ? ORDER BY distance ASC
                `, [lat, lng, lat, maxDistance], (err, rows) => {
                    if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
                    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(rows)); }
                });
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    // ==================== PROFILE ENDPOINTS ====================
    
    if (req.url.match(/^\/api\/professionals\/.+\/profile$/) && req.method === 'GET') {
        const professionalId = req.url.split('/')[3];
        const profile = {};
        db.get('SELECT id, name, phone, bio, skills, profile_picture, lat, lng FROM users WHERE id = ? AND role = "professional"', [professionalId], (err, user) => {
            if (err || !user) { res.writeHead(404); res.end(JSON.stringify({ error: 'Professional not found' })); return; }
            profile.user = user;
            db.all('SELECT * FROM education WHERE user_id = ? ORDER BY created_at DESC', [professionalId], (err, edu) => {
                profile.education = edu || [];
                db.all('SELECT * FROM work_experience WHERE user_id = ? ORDER BY created_at DESC', [professionalId], (err, work) => {
                    profile.workExperience = work || [];
                    db.all('SELECT * FROM certifications WHERE user_id = ? ORDER BY created_at DESC', [professionalId], (err, certs) => {
                        profile.certifications = certs || [];
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(profile));
                    });
                });
            });
        });
        return;
    }
    
    // ==================== EDUCATION ENDPOINTS ====================
    
    if (req.url === '/api/add-education' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, degree, institution, year } = JSON.parse(body);
                const id = 'edu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                db.run(`INSERT INTO education (id, user_id, degree, institution, year, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, user_id, degree, institution, year || '', Date.now()]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url.match(/^\/api\/delete-education\/.+/)) {
        const eduId = req.url.split('/')[3];
        db.run('DELETE FROM education WHERE id = ?', [eduId]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    if (req.url === '/api/add-work' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, title, company, start_year, end_year, description } = JSON.parse(body);
                const id = 'work_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                db.run(`INSERT INTO work_experience (id, user_id, title, company, start_year, end_year, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, user_id, title, company, start_year || '', end_year || '', description || '', Date.now()]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url.match(/^\/api\/delete-work\/.+/)) {
        const workId = req.url.split('/')[3];
        db.run('DELETE FROM work_experience WHERE id = ?', [workId]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    if (req.url === '/api/add-certification' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { user_id, name, issuer, year, document_url } = JSON.parse(body);
                const id = 'cert_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                db.run(`INSERT INTO certifications (id, user_id, name, issuer, year, document_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, user_id, name, issuer, year || '', document_url || '', Date.now()]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url.match(/^\/api\/delete-certification\/.+/)) {
        const certId = req.url.split('/')[3];
        db.run('DELETE FROM certifications WHERE id = ?', [certId]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    // ==================== APPLICATIONS ENDPOINTS ====================
    
    if (req.url === '/api/apply-to-gig' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { gig_id, professional_id, bid_amount, message } = JSON.parse(body);
                const id = 'app_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
                db.run(`INSERT INTO gig_applications (id, gig_id, professional_id, bid_amount, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, gig_id, professional_id, bid_amount || null, message || '', 'pending', Date.now()]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    if (req.url.match(/^\/api\/gig-applications\/.+/)) {
        const gigId = req.url.split('/')[3];
        db.all(`
            SELECT a.*, u.name, u.phone, u.bio, u.skills, u.profile_picture, u.lat, u.lng
            FROM gig_applications a JOIN users u ON a.professional_id = u.id
            WHERE a.gig_id = ? AND a.status = 'pending' ORDER BY a.created_at DESC
        `, [gigId], (err, rows) => {
            if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
            else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(rows)); }
        });
        return;
    }
    
    if (req.url === '/api/select-professional' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { gig_id, professional_id } = JSON.parse(body);
                db.get('SELECT name FROM users WHERE id = ?', [professional_id], (err, pro) => {
                    db.run(`UPDATE gigs SET status = 'accepted', professional_id = ?, professional_name = ? WHERE id = ?`,
                        [professional_id, pro.name, gig_id]);
                    db.run(`UPDATE gig_applications SET status = 'accepted' WHERE gig_id = ? AND professional_id = ?`, [gig_id, professional_id]);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
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
            if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
            else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(rows)); }
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
    
    // ==================== STATS ENDPOINTS ====================
    
    if (req.url === '/api/stats' && req.method === 'GET') {
        const stats = {};
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
        return;
    }
    
    // ==================== REPORTS ENDPOINTS ====================
    
    if (req.url === '/api/reports' && req.method === 'GET') {
        db.all('SELECT * FROM reports ORDER BY created_at DESC', (err, rows) => {
            if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
            else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(rows)); }
        });
        return;
    }
    
    if (req.url === '/api/reports' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const report = JSON.parse(body);
                db.run(`INSERT INTO reports (id, reporter_id, gig_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [report.id, report.reporter_id, report.gig_id, report.reason, report.details || '', 'pending', Date.now()]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }
    
    // ==================== DELETE USER ====================
    
    if (req.url.match(/^\/api\/users\/.+\/delete$/) && req.method === 'DELETE') {
        const userId = req.url.split('/')[3];
        db.run('DELETE FROM users WHERE id = ?', [userId]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // 404 handler
    res.writeHead(404);
    res.end('Not found');
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`✅ Production server running on port ${port}`);
    console.log(`✅ Twilio Verify active`);
    console.log(`✅ Admin login available at /login.html`);
    console.log(`   Username: admin`);
    console.log(`   Password: admin123`);
});