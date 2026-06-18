const fs = require('fs');
const mysql = require('mysql2/promise');

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [result] = await conn.query(`
    DELETE l FROM leads l
    LEFT JOIN messages m ON m.contact_id = l.contact_id AND m.direction = 'inbound'
    LEFT JOIN lead_activities la ON la.lead_id = l.id AND la.description = 'Lead auto-created from WhatsApp message'
    WHERE m.id IS NULL AND la.id IS NULL
      AND EXISTS (
        SELECT 1 FROM lead_activities la2
        WHERE la2.lead_id = l.id AND la2.description = 'Lead imported from contacts'
      )
  `);

  console.log('Deleted leads:', result.affectedRows);

  const [[{ remaining }]] = await conn.query(`SELECT COUNT(*) as remaining FROM leads`);
  console.log('Leads remaining:', remaining);

  await conn.end();
})();
