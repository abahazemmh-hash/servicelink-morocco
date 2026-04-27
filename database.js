const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'servicelink.db'));

db.serialize(() => {
    // Users table - ADDED lat, lng
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            is_verified INTEGER DEFAULT 0,
            role TEXT NOT NULL,
            bio TEXT,
            skills TEXT,
            balance INTEGER DEFAULT 0,
            lat REAL,
            lng REAL,
            location_updated_at INTEGER,
            created_at INTEGER
        )
    `);

    // Gigs table - ADDED lat, lng, address
    db.run(`
        CREATE TABLE IF NOT EXISTS gigs (
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
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            gig_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS cashplus_deposits (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            reference TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at INTEGER,
            verified_at INTEGER
        )
    `);

    console.log('✅ Database ready with location support');
});

module.exports = db;