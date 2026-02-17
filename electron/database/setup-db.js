import sqlite3 from "sqlite3"
import fs from "fs"

const db = new sqlite3.Database("./src/database/database.db", (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("Connected to existing database!");
  }
});

const schema = fs.readFileSync("./src/database/schema.sql", "utf-8");
const seed = fs.readFileSync("./src/database/seed.sql", "utf-8");

db.exec(schema, (err) => {
  if (err) {
    console.error("Error creating schema:", err.message)
  } else {
    console.log("Schema created successfully.")

    db.exec(seed, (err2) => {
      if (err2) {
        console.error("Error inserting seed data:", err2.message)
      } else {
        console.log("Seed data inserted successfully.")
      }
      db.close()
    })
  }
})
