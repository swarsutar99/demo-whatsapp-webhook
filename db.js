const sqlite3 = require('sqlite3').verbose();

// Create (or open) the database file
const db = new sqlite3.Database('./betting.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Create the Bets table if it does not exist
db.run(`
    CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match TEXT NOT NULL,
        market TEXT NOT NULL,
        runner INTEGER NOT NULL,
        amount DECIMAL(10,2) NOT NULL
    )
`, (err) => {
    if (err) {
        console.error('Error creating table', err);
    } else {
        console.log('Bets table is ready');
    }
});

module.exports = db;
