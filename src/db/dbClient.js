import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "hospital_coordination",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// pool.query("SELECT DATABASE()").then(([r]) => console.log(r));

export default pool;
