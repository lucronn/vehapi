/**
 * Cloud SQL (PostgreSQL) connection pool via `pg`.
 *
 * Cloud Run:  set CLOUD_SQL_CONNECTION_NAME (e.g. "vehapi-torque:us-central1:vehapi")
 *             pg connects via Unix socket  /cloudsql/<CONNECTION_NAME>/.s.PGSQL.5432
 *             Also set DB_NAME, DB_USER, DB_PASSWORD.
 *
 * Local dev:  set DATABASE_URL (full Postgres URI).
 */
import pg from 'pg';
const { Pool } = pg;

let _pool = null;

export function getPool() {
    if (_pool) return _pool;

    const connName = (process.env.CLOUD_SQL_CONNECTION_NAME || '').trim();
    const dbUrl = (process.env.DATABASE_URL || '').trim();

    if (!connName && !dbUrl) return null;

    // Keep pool small — Cloud SQL db-f1-micro allows ~25 connections total,
    // shared across server + up to 3 worker processes.
    const poolMax = parseInt(process.env.DB_POOL_MAX || '5', 10) || 5;
    const connTimeout = parseInt(process.env.DB_CONN_TIMEOUT_MS || '15000', 10) || 15000;
    const base = { max: poolMax, connectionTimeoutMillis: connTimeout, idleTimeoutMillis: 30000 };
    const config = dbUrl
        ? { connectionString: dbUrl, ...base }
        : {
              host: `/cloudsql/${connName}`,
              database: (process.env.DB_NAME || 'postgres').trim(),
              user: (process.env.DB_USER || 'postgres').trim(),
              password: (process.env.DB_PASSWORD || '').trim(),
              ...base,
          };

    _pool = new Pool(config);

    _pool.on('error', (err) => {
        console.error('[db] idle client error:', err.message);
    });

    return _pool;
}

/**
 * Run a SQL query against Cloud SQL.
 * @param {string} sql
 * @param {unknown[]} [values]
 */
export async function dbQuery(sql, values) {
    const pool = getPool();
    if (!pool) throw new Error('DB not configured (set CLOUD_SQL_CONNECTION_NAME or DATABASE_URL)');
    return pool.query(sql, values);
}

/** True when Cloud SQL is configured. */
export function isDbConfigured() {
    return Boolean(
        (process.env.CLOUD_SQL_CONNECTION_NAME || '').trim() ||
            (process.env.DATABASE_URL || '').trim()
    );
}
