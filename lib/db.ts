/**
 * lib/db.ts
 * MySQL connection pool using mysql2/promise
 * Uses connection pooling for production performance
 */
import mysql from 'mysql2/promise';

declare global {
  // eslint-disable-next-line no-var
  var _mysqlPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    throw new Error('Missing required database environment variables: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  }
  return mysql.createPool({
    host:               process.env.DB_HOST,
    port:               Number(process.env.DB_PORT) || 3306,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    database:           process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit:    5,   // lower limit for serverless (Vercel) — DB user has max_user_connections=30, shared across ALL panel users
    queueLimit:         0,
    charset:            'utf8mb4',
    timezone:           'Z',         // session timezone = UTC
    dateStrings:        true,        // return datetime as strings, not Date objects
  });
}

// Singleton pool to avoid exhausting connections in dev (HMR)
const pool: mysql.Pool = global._mysqlPool ?? createPool();
if (process.env.NODE_ENV !== 'production') global._mysqlPool = pool;

export default pool;

// ---- helper: run a query and return rows typed as T ----
export async function query<T = mysql.RowDataPacket[]>(
  sql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any[]
): Promise<T> {
  const [rows] = await pool.execute(sql, params);
  return rows as T;
}

// ---- helper: run INSERT and return insertId ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insert(sql: string, params?: any[]): Promise<number> {
  const [result] = await pool.execute(sql, params);
  return (result as mysql.ResultSetHeader).insertId;
}

// ---- helper: run UPDATE/DELETE and return affectedRows ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function execute(sql: string, params?: any[]): Promise<number> {
  const [result] = await pool.execute(sql, params);
  return (result as mysql.ResultSetHeader).affectedRows;
}
