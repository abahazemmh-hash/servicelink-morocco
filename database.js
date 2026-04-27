const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'servicelink.db');

let db;

try {
  db = new Database(DB_PATH);
  console.log('✅ SQLite connected via better-sqlite3');
} catch (err) {
  console.error('❌ Database connection failed:', err.message);
  process.exit(1);
}

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// ========== INITIALIZE DATABASE IMMEDIATELY ==========
// This runs BEFORE any prepared statements are created

// Users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('household', 'professional')),
    bio TEXT DEFAULT '',
    skills TEXT DEFAULT '',
    balance INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Gigs table
db.exec(`
  CREATE TABLE IF NOT EXISTS gigs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    urgency TEXT DEFAULT 'normal',
    description TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'accepted', 'completed')),
    household_id TEXT NOT NULL,
    household_name TEXT NOT NULL,
    professional_id TEXT,
    professional_name TEXT,
    completed_by TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    rating INTEGER,
    review TEXT DEFAULT ''
  )
`);

// Messages table
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gig_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Reports table
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id TEXT NOT NULL,
    reporter_name TEXT NOT NULL,
    gig_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'resolved')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// CashPlus deposits table
db.exec(`
  CREATE TABLE IF NOT EXISTS cashplus_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reference TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'verified')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME
  )
`);

// Insert demo users if none exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, phone, role, bio, skills, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('user_hh_001', 'Ahmed Benali', '+212 612-345678', 'household', 'Homeowner in Casablanca', '', 0);
  insertUser.run('user_pro_001', 'Karim Idrissi', '+212 699-123456', 'professional', '10+ years plumbing & electrical experience', 'Plumbing, Electrical', 0);
  insertUser.run('user_pro_002', 'Fatima Zahra', '+212 611-987654', 'professional', 'Professional painter and decorator', 'Painting, Cleaning', 100);

  console.log('✅ Demo users created');
}

// Insert demo gigs if none exist
const gigCount = db.prepare('SELECT COUNT(*) as count FROM gigs').get();
if (gigCount.count === 0) {
  const insertGig = db.prepare(`
    INSERT INTO gigs (id, title, category, urgency, description, status, household_id, household_name, professional_id, professional_name, completed_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertGig.run(
    'gig_001', 'Fix Leaky Kitchen Faucet', 'Plumbing', 'urgent',
    'The kitchen faucet has been dripping for 3 days. Need someone today if possible.',
    'open', 'user_hh_001', 'Ahmed Benali', null, null, '[]', new Date(Date.now() - 3600000).toISOString()
  );

  insertGig.run(
    'gig_002', 'Paint Living Room', 'Painting', 'normal',
    'Looking to paint a 20sqm living room. Paint provided. Need experienced painter.',
    'open', 'user_hh_001', 'Ahmed Benali', null, null, '[]', new Date(Date.now() - 7200000).toISOString()
  );

  insertGig.run(
    'gig_003', 'Install Ceiling Fans', 'Electrical', 'normal',
    'Need 3 ceiling fans installed in bedrooms. Building is old, may need wiring check.',
    'accepted', 'user_hh_001', 'Ahmed Benali', 'user_pro_001', 'Karim Idrissi', '[]', new Date(Date.now() - 1800000).toISOString()
  );

  console.log('✅ Demo gigs created');
}

console.log('✅ Database initialized');

// ========== PREPARED STATEMENTS (defined AFTER tables exist) ==========

const queries = {
  // Users
  getUserByPhone: db.prepare('SELECT * FROM users WHERE phone = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  getAllUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),
  createUser: db.prepare(`
    INSERT INTO users (id, name, phone, role, bio, skills, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  updateUser: db.prepare(`
    UPDATE users SET name = ?, bio = ?, skills = ? WHERE id = ?
  `),
  updateBalance: db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  // Gigs
  getAllGigs: db.prepare('SELECT * FROM gigs ORDER BY created_at DESC'),
  getGigById: db.prepare('SELECT * FROM gigs WHERE id = ?'),
  createGig: db.prepare(`
    INSERT INTO gigs (id, title, category, urgency, description, status, household_id, household_name, completed_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateGigStatus: db.prepare('UPDATE gigs SET status = ? WHERE id = ?'),
  assignProfessional: db.prepare(`
    UPDATE gigs SET professional_id = ?, professional_name = ?, status = 'accepted' WHERE id = ?
  `),
  updateCompletedBy: db.prepare('UPDATE gigs SET completed_by = ? WHERE id = ?'),
  completeGig: db.prepare(`
    UPDATE gigs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  rateGig: db.prepare('UPDATE gigs SET rating = ?, review = ? WHERE id = ?'),
  deleteGig: db.prepare('DELETE FROM gigs WHERE id = ?'),

  // Messages
  getMessagesByGig: db.prepare('SELECT * FROM messages WHERE gig_id = ? ORDER BY created_at ASC'),
  createMessage: db.prepare(`
    INSERT INTO messages (gig_id, sender_id, sender_name, text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),

  // Reports
  getAllReports: db.prepare('SELECT * FROM reports ORDER BY created_at DESC'),
  createReport: db.prepare(`
    INSERT INTO reports (reporter_id, reporter_name, gig_id, reason, details, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `),
  resolveReport: db.prepare('UPDATE reports SET status = ? WHERE id = ?'),

  // CashPlus
  createCashPlus: db.prepare(`
    INSERT INTO cashplus_deposits (user_id, user_name, amount, reference, status)
    VALUES (?, ?, ?, ?, 'pending')
  `),
  getPendingCashPlus: db.prepare(`
    SELECT * FROM cashplus_deposits WHERE status = 'pending' ORDER BY created_at DESC
  `),
  verifyCashPlus: db.prepare(`
    UPDATE cashplus_deposits SET status = 'verified', verified_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  getCashPlusByRef: db.prepare('SELECT * FROM cashplus_deposits WHERE reference = ?'),

  // Stats
  getStats: db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM users WHERE role = 'professional') as total_pros,
      (SELECT COUNT(*) FROM gigs) as total_gigs,
      (SELECT COUNT(*) FROM gigs WHERE status = 'open') as open_gigs,
      (SELECT COUNT(*) FROM gigs WHERE status = 'accepted') as active_gigs,
      (SELECT COUNT(*) FROM gigs WHERE status = 'completed') as completed_gigs,
      (SELECT COALESCE(SUM(balance), 0) FROM users WHERE role = 'professional') as total_wallet
  `)
};

function initDatabase() {
  // Already initialized above — this is here for backward compatibility
  console.log('✅ Database already initialized');
}

module.exports = { db, initDatabase, queries };