/**
 * DTCs repository — DTC summaries and logic_nodes (diagnostic trees).
 */
import { dbQuery } from '../db.js';

/**
 * Upsert logic nodes for a diagnostic tree.
 * Conflict key: node_id (uuid, stable across re-extractions of same tree).
 *
 * @param {object[]} nodes - validated LogicNode objects from extractor
 */
export async function upsertLogicNodes(nodes) {
    if (!nodes.length) return;
    for (const n of nodes) {
        await dbQuery(
            `INSERT INTO logic_nodes
               (node_id, tree_id, vehicle_id, dtc_code, node_type,
                input_criteria, edge_logic, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,now())
             ON CONFLICT (node_id)
             DO UPDATE SET
               tree_id        = EXCLUDED.tree_id,
               dtc_code       = EXCLUDED.dtc_code,
               node_type      = EXCLUDED.node_type,
               input_criteria = EXCLUDED.input_criteria,
               edge_logic     = EXCLUDED.edge_logic,
               updated_at     = now()`,
            [
                n.node_id,
                n.tree_id,
                n.vehicle_id,
                n.dtc_code ?? null,
                n.node_type,
                JSON.stringify(n.input_criteria ?? {}),
                JSON.stringify(n.edges ?? []),
            ]
        );
    }
}

/**
 * Fetch a full diagnostic tree for a vehicle + DTC code.
 * Returns all nodes ordered for traversal (entry nodes — no incoming edges — first).
 */
export async function getLogicTree(vehicleId, dtcCode) {
    const { rows } = await dbQuery(
        `SELECT node_id, tree_id, node_type, input_criteria, edge_logic, created_at
         FROM logic_nodes
         WHERE vehicle_id = $1 AND dtc_code = $2
         ORDER BY created_at`,
        [vehicleId, dtcCode]
    );
    return rows;
}

/**
 * Fetch a DTC summary row (from the dtcs table, not logic_nodes).
 */
export async function getDtcByCode(vehicleId, code) {
    const { rows } = await dbQuery(
        `SELECT id, code, description, bucket FROM dtcs
         WHERE vehicle_id = $1 AND code = $2 LIMIT 1`,
        [vehicleId, code]
    );
    return rows[0] ?? null;
}
