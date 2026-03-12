import pg from 'pg';
const { Client } = pg;

const connectionString = "postgres://postgres.jzwhcoivwzumqrfscnlw:B43gsM5l0bQNxtMOPUbPu8lrl87QBGPgrTPm66fdewI@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

async function applyMigration() {
    console.log("Connecting to database...");
    const client = new Client({ connectionString });
    await client.connect();

    console.log("Starting migration: Users table...");

    const sql = `
        -- Create users table
        CREATE TABLE IF NOT EXISTS public.users (
            id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            credits INTEGER DEFAULT 0,
            unlocks JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
        );

        -- Enable RLS
        ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

        -- Create policy for users to see their own profile
        DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
        CREATE POLICY "Users can view own profile" 
        ON public.users FOR SELECT 
        USING (auth.uid() = id);
    `;

    try {
        await client.query(sql);
        console.log("Migration finished successfully.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await client.end();
    }
}

applyMigration();
