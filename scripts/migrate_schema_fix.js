import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "hospital_coordination",
  });

  try {
    console.log(
      "Running migration: Modify emergency_level_supported to VARCHAR(100)...",
    );
    await connection.query(
      "ALTER TABLE hospitals MODIFY COLUMN emergency_level_supported VARCHAR(100)",
    );
    console.log("Migration successful.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await connection.end();
  }
}

migrate();
