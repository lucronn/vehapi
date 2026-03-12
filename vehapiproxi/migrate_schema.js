import pg from 'pg';
const { Client } = pg;

const connectionString = "postgres://postgres.jzwhcoivwzumqrfscnlw:B43gsM5l0bQNxtMOPUbPu8lrl87QBGPgrTPm66fdewI@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

async function applyMigration() {
    console.log("Connecting to database...");
    const client = new Client({ connectionString });
    await client.connect();

    console.log("Starting migration...");

    // Commands to drop foreign keys
    const dropConstraints = [
        "ALTER TABLE procedures DROP CONSTRAINT IF EXISTS procedures_vehicle_id_fkey;",
        "ALTER TABLE tsbs DROP CONSTRAINT IF EXISTS tsbs_vehicle_id_fkey;",
        "ALTER TABLE dtcs DROP CONSTRAINT IF EXISTS dtcs_vehicle_id_fkey;",
        "ALTER TABLE specifications DROP CONSTRAINT IF EXISTS specifications_vehicle_id_fkey;",
        "ALTER TABLE maintenance_schedules DROP CONSTRAINT IF EXISTS maintenance_schedules_vehicle_id_fkey;",
        "ALTER TABLE labor DROP CONSTRAINT IF EXISTS labor_vehicle_id_fkey;",
        "ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_vehicle_id_fkey;",
        "ALTER TABLE diagrams DROP CONSTRAINT IF EXISTS diagrams_vehicle_id_fkey;",
        "ALTER TABLE ai_processing_logs DROP CONSTRAINT IF EXISTS ai_processing_logs_vehicle_id_fkey;"
    ];

    // Commands to alter the vehicle_id column type
    const alterColumns = [
        "ALTER TABLE procedures ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE tsbs ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE dtcs ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE specifications ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE maintenance_schedules ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE labor ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE parts ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE diagrams ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;",
        "ALTER TABLE ai_processing_logs ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;"
    ];

    try {
        await client.query('BEGIN');

        for (const query of dropConstraints) {
            console.log(`Executing: ${query}`);
            await client.query(query);
        }

        for (const query of alterColumns) {
            console.log(`Executing: ${query}`);
            await client.query(query);
        }

        await client.query('COMMIT');
        console.log("Migration finished successfully.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Migration failed:", e);
    } finally {
        await client.end();
    }
}

applyMigration();
