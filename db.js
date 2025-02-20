import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Open or create the database
const db = await open({
    filename: './betting.db',
    driver: sqlite3.Database
});

// Ensure the Bets table exists
await db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match TEXT NOT NULL,
        market TEXT NOT NULL,
        runner INTEGER NOT NULL,
        amount DECIMAL(10,2) NOT NULL
    )
`);

console.log('Connected to SQLite database and Bets table is ready');

export default db;
