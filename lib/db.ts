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
    // Serverless (Vercel): har instance apna pool banata hai. DB user ki
    // max_user_connections (e.g. 30) SABHI instances ke beech shared hai, isliye
    // per-instance limit chhota rakho. Env se tune ho sakta hai bina redeploy.
    connectionLimit:    Number(process.env.DB_CONNECTION_LIMIT) || 3,
    queueLimit:         0,            // 0 = unlimited queue (error ke bajaye wait)
    // Idle connections ko jaldi band karo taaki dusre instances ke liye slot khaali ho
    maxIdle:            1,
    idleTimeout:        15000,        // 15s baad idle connection close
    enableKeepAlive:    true,
    keepAliveInitialDelay: 10000,
    charset:            'utf8mb4',
    timezone:           'Z',         // session timezone = UTC
    dateStrings:        true,        // return datetime as strings, not Date objects
  });
}

// Lazy singleton: pool banta hai sirf pehle actual DB call par, module import par nahi.
// Next.js build ke "Collecting page data" step me har route module import hota hai
// (sirf metadata ke liye) — agar pool yahin ban jaaye to build-time par hi DB env vars
// chahiye ho jaate hain, jabki build container me wo set nahi hote.
function getPool(): mysql.Pool {
  if (!global._mysqlPool) global._mysqlPool = createPool();
  return global._mysqlPool;
}

// Backward-compatible default export: property/method access par hi pool resolve hota hai.
const pool = new Proxy({} as mysql.Pool, {
  get(_target, prop, _receiver) {
    const actual = getPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (actual as any)[prop];
    return typeof value === 'function' ? value.bind(actual) : value;
  },
});

export default pool;

// ---- In-app campaign scheduler boot ------------------------------------
// db.ts is imported by every API route, so the first request after server
// start boots the every-minute campaign processor (lib/campaignProcessor).
// Production only — dev servers point at the prod DB and must never
// auto-send campaigns. Deferred dynamic import avoids a circular init
// (campaignProcessor itself imports this module); unref'd timers never keep
// the process alive (so `next build` can exit cleanly).
if (
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  process.env.DISABLE_INTERNAL_CRON !== '1'
) {
  const bootTimer = setTimeout(() => {
    import('./campaignProcessor')
      .then((m) => m.startInternalCron())
      .catch((err) => console.error('[campaign-cron] boot failed:', err));
  }, 5000);
  bootTimer.unref?.();
}

// ---- helper: run a query and return rows typed as T ----
export async function query<T = mysql.RowDataPacket[]>(
  sql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any[]
): Promise<T> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T;
}

// ---- helper: run INSERT and return insertId ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insert(sql: string, params?: any[]): Promise<number> {
  const [result] = await getPool().execute(sql, params);
  return (result as mysql.ResultSetHeader).insertId;
}

// ---- helper: run UPDATE/DELETE and return affectedRows ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function execute(sql: string, params?: any[]): Promise<number> {
  const [result] = await getPool().execute(sql, params);
  return (result as mysql.ResultSetHeader).affectedRows;
}
