import fs from "fs";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDb() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD,
    multipleStatements: true,
  });

  try {
    const schemaPath = path.join(__dirname, "../sql/schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    console.log("Running schema...");
    await connection.query(schema);
    console.log("Database initialized successfully.");
  } catch (error) {
    console.error("Error initializing database:", error);
  } finally {
    await connection.end();
  }
}

initDb();
