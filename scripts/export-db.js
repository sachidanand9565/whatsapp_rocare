/**
 * scripts/export-db.js
 * Dumps the full production MySQL database (schema + data) to a .sql file.
 * Run with: node scripts/export-db.js
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

function escapeValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function connect() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    connectTimeout: 30000,
  });
}

const PAGE_SIZE = 2000;

async function dumpTable(table, out) {
  let conn = await connect();
  try {
    const [[{ 'Create Table': createStmt }]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
    out.write(`--\n-- Table structure for \`${table}\`\n--\n`);
    out.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);
    out.write(`${createStmt};\n\n`);

    const [[{ cnt }]] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
    if (cnt === 0) return;

    out.write(`--\n-- Data for \`${table}\` (${cnt} rows)\n--\n`);
    let offset = 0;
    let columns = null;
    while (offset < cnt) {
      let rows;
      try {
        [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      } catch (err) {
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.fatal) {
          console.log(`  connection lost, reconnecting at offset ${offset}...`);
          try { await conn.end(); } catch (_) {}
          conn = await connect();
          [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
        } else {
          throw err;
        }
      }
      if (rows.length === 0) break;
      if (!columns) columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `\`${c}\``).join(', ');
      const valuesSql = rows
        .map((row) => `(${columns.map((c) => escapeValue(row[c])).join(', ')})`)
        .join(',\n');
      out.write(`INSERT INTO \`${table}\` (${colList}) VALUES\n${valuesSql};\n`);

      offset += rows.length;
      console.log(`  ${table}: ${offset}/${cnt}`);
    }
    out.write('\n');
  } finally {
    await conn.end();
  }
}

async function main() {
  const dbName = process.env.DB_NAME;

  let listConn = await connect();
  const [tables] = await listConn.query('SHOW TABLES');
  await listConn.end();
  const tableKey = `Tables_in_${dbName}`;
  const tableNames = tables.map((row) => row[tableKey]);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(__dirname, '..', 'backups', `${dbName}-${timestamp}.sql`);
  const out = fs.createWriteStream(outPath);

  out.write(`-- Export of database \`${dbName}\`\n-- Generated ${new Date().toISOString()}\n\n`);
  out.write('SET FOREIGN_KEY_CHECKS=0;\n\n');

  for (const table of tableNames) {
    console.log(`Dumping ${table}...`);
    await dumpTable(table, out);
  }

  out.write('SET FOREIGN_KEY_CHECKS=1;\n');
  await new Promise((resolve) => out.end(resolve));

  console.log(`\nDone. Exported ${tableNames.length} tables to: ${outPath}`);
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
