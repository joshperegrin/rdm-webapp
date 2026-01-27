// db.js
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// fix __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make sure path points to your actual database
const dbPath = path.join(__dirname, 'database.db');
const db = new Database(dbPath);

export default db;
