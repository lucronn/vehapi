import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

async function main() {
    try {
        const client = await pool.connect();
        console.log("Running fast index query...");
        const res = await client.query(`
            SELECT vehicle_id, COUNT(*) 
            FROM articles 
            WHERE vehicle_id IN ('271312%3A16774', '271310%3A16774', '271311%3A16774', '271312:16774', '271310:16774', '271311:16774', '16774') 
            GROUP BY vehicle_id
        `);
        console.log("Query results in articles table:");
        console.log(res.rows);
        client.release();
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
