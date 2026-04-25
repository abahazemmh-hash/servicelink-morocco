const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'servicelink.db'));

db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL,
            bio TEXT,
            skills TEXT,
            balance INTEGER DEFAULT 0,
            created_at INTEGER
        )
    `);

    // Gigs table - with completed_by column
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
            created_at INTEGER,
            completed_at INTEGER,
            rating INTEGER,
            review TEXT
        )
    `);

    // Messages table
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

    // Reports table
    db.run(`
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            reporter_id TEXT NOT NULL,
            gig_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            details TEXT,
            status TEXT DEFAULT 'pending',
            created_at INTEGER
        )
    `);

    // CashPlus deposits table
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

    console.log('✅ Database tables created successfully');
});

module.exports = db;