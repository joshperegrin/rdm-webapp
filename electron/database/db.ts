import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store database in /resources — this folder is NEVER wiped by Vite rebuilds
// In dev:  <project-root>/resources/database.db
// In prod: <app>/resources/database.db (packaged by electron-builder)
const resourcesPath = process.env.VITE_DEV_SERVER_URL
  ? path.join(__dirname, '..', 'resources')       // dev:  dist-electron/../resources
  : path.join(process.resourcesPath);              // prod: packaged resources path

const dbPath = path.join(resourcesPath, 'database.db');

console.log('[DB] Database path:', dbPath);

const db = new Database(dbPath, { verbose: console.log });

const schemaPath = path.join(__dirname, 'schema.sql');
const seedPath = path.join(__dirname, 'seed.sql');

const tableCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='road_defects'").get() as { count: number };

if (tableCheck.count === 0) {
  console.log("Database appears empty. Initializing tables...");

  try {
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
      db.exec(schemaSql);
      console.log("Schema applied successfully.");
    } else {
      console.error(`CRITICAL: schema.sql not found at ${schemaPath}`);
    }

    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf-8');
      db.exec(seedSql);
      console.log("Seed data injected successfully.");
    } else {
      console.warn(`seed.sql not found at ${seedPath}`);
    }

  } catch (err) {
    console.error("Error initializing database:", err);
  }
} else {
  console.log("Database tables already exist.");
}

export default db;