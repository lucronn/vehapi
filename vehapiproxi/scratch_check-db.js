import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function main() {
    console.log("Connecting to DATABASE_URL...");
    try {
        const client = await pool.connect();
        console.log("Connected successfully!");

        // Try raw and encoded versions of the vehicle IDs
        const ids = ['271312%3A16774', '271310%3A16774', '271311%3A16774', '271312:16774', '271310:16774', '271311:16774', '16774'];
        for (const id of ids) {
            const res = await client.query('SELECT COUNT(*) as n FROM articles WHERE vehicle_id = $1', [id]);
            console.log(`Articles for EXACT vehicle_id '${id}': ${res.rows[0].n}`);
        }

        client.release();
    } catch (e) {
        console.error("Database query error:", e);
    } finally {
        await pool.end();
    }
}

main();
