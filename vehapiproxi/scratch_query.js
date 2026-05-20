import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

async function main() {
    try {
        const client = await pool.connect();
        const res = await client.query("SELECT DISTINCT vehicle_id, COUNT(*) FROM articles WHERE vehicle_id LIKE '%16774%' GROUP BY vehicle_id");
        console.log("Distinct vehicle_ids with 16774 in articles table:");
        console.log(res.rows);

        const vres = await client.query("SELECT DISTINCT external_id, is_normalized FROM vehicles WHERE external_id LIKE '%16774%'");
        console.log("Distinct external_ids with 16774 in vehicles table:");
        console.log(vres.rows);
        
        client.release();
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
