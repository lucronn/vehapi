const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

// Connection Pooler Configuration
// Host: aws-0-us-west-2.pooler.supabase.com
// User: postgres.jzwhcoivwzumqrfscnlw
// Pass: {Fucker900*lol!} (Exactly as provided, with braces)
const HOST = 'aws-0-us-west-2.pooler.supabase.com';
const USER = 'postgres.jzwhcoivwzumqrfscnlw';
const PASS = '{Fucker900*lol!}';
const DB = 'postgres';
const PORT = 5432; // Pooler port

async function runSqlFile(client, filename) {
  console.log(`Reading ${filename}...`);
  const filePath = path.join(__dirname, '..', filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  console.log(`Executing ${filename}...`);
  // Split by semicolon? No, pg client can mostly handle it, but large files might need streaming.
  // Ideally we assume standard SQL script. 'query' method usually handles multiple statements in pg.
  await client.query(sql);
  console.log(`✅ ${filename} executed successfully!`);
}

async function apply() {
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
    host: ip, // Try resolved IP to bypass potential IPv6 issues
    port: PORT,
    user: USER,
    password: PASS,
    database: DB,
    ssl: { rejectUnauthorized: false, servername: HOST }, // servername is critical when connecting via IP
    connectionTimeoutMillis: 15000
  });

  try {
    console.log('Connecting to PostgreSQL Pooler...');
    await client.connect();
    console.log('Connected!');

    // 1. Apply Schema
    await runSqlFile(client, 'supabase_schema.sql');

    // 2. Apply Seed Data
    await runSqlFile(client, 'seed_data_2009.sql');

  } catch (err) {
    console.error('❌ Failed to execute SQL:', err);
  } finally {
    await client.end();
  }
}

apply();
