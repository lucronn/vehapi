const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const HOST = 'db.jzwhcoivwzumqrfscnlw.supabase.co';
const USER = 'postgres';
const PASS = 'Fucker900*lol!';
const DB = 'postgres';
const PORT = 5432;

async function applySchema() {
  let ip = HOST;
  try {
    console.log(`Resolving IPv4 for ${HOST}...`);
    const addresses = await dns.resolve4(HOST);
    if (addresses && addresses.length > 0) {
      ip = addresses[0];
      console.log(`Resolved to: ${ip}`);
    } else {
      console.log('No IPv4 address found, using hostname.');
    }
  } catch (err) {
    console.error('DNS Resolution failed:', err.message);
  }

  const client = new Client({
    host: ip,
    port: PORT,
    user: USER,
    password: PASS,
    database: DB,
    ssl: { rejectUnauthorized: false, servername: HOST } // servername required for SSL with IP
  });

  try {
    console.log('Connecting to PostgreSQL database...');
    await client.connect();
    console.log('Connected!');

    console.log('Reading schema file...');
    const schemaPath = path.join(__dirname, '..', 'supabase_schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Applying schema...');
    await client.query(sql);
    console.log('✅ Schema applied successfully!');

  } catch (err) {
    console.error('❌ Failed to apply schema:', err);
  } finally {
    await client.end();
  }
}

applySchema();
