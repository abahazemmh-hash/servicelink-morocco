const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'servicelink.db'));

db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_verified INTEGER DEFAULT 0,
        role TEXT NOT NULL,
        bio TEXT,
        skills TEXT,
        balance INTEGER DEFAULT 0,
        profile_picture TEXT,
        lat REAL,
        lng REAL,
        location_updated_at INTEGER,
        profile_completed INTEGER DEFAULT 0,
        created_at INTEGER
    )`);

    // Gigs table
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
        address TEXT,
        lat REAL,
        lng REAL,
        created_at INTEGER,
        completed_at INTEGER,
        rating INTEGER,
        review TEXT
    )`);

    // Education table
    db.run(`CREATE TABLE IF NOT EXISTS education (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        degree TEXT NOT NULL,
        institution TEXT NOT NULL,
        year TEXT,
        created_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Work Experience table
    db.run(`CREATE TABLE IF NOT EXISTS work_experience (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        start_year TEXT,
        end_year TEXT,
        description TEXT,
        created_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Certifications table
    db.run(`CREATE TABLE IF NOT EXISTS certifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        issuer TEXT NOT NULL,
        year TEXT,
        document_url TEXT,
        created_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        gig_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER
    )`);

    // Gig applications table
    db.run(`CREATE TABLE IF NOT EXISTS gig_applications (
        id TEXT PRIMARY KEY,
        gig_id TEXT NOT NULL,
        professional_id TEXT NOT NULL,
        bid_amount INTEGER,
        message TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER,
        FOREIGN KEY (gig_id) REFERENCES gigs(id),
        FOREIGN KEY (professional_id) REFERENCES users(id)
    )`);

    // Reports table
    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL,
        gig_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER
    )`);

    // Admins table
    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER
    )`);

    // CashPlus deposits table
    db.run(`CREATE TABLE IF NOT EXISTS cashplus_deposits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reference TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER,
        verified_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Analytics table
    db.run(`CREATE TABLE IF NOT EXISTS analytics (
        id TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        event_data TEXT,
        user_id TEXT,
        page TEXT,
        created_at INTEGER
    )`);

    console.log('✅ Production database ready');
});

module.exports = db;