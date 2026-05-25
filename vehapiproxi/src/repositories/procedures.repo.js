/**
 * Procedures repository — atomic steps and procedure reads/writes.
 */
import { dbQuery } from '../db.js';

/**
 * Upsert an array of AtomicStep rows for a procedure.
 * Conflict key: (vehicle_id, source_article_id, step_index).
 *
 * @param {string} vehicleId
 * @param {string} procedureId - uuid FK into procedures
 * @param {object[]} steps - validated AtomicStep objects from extractor
 */
export async function upsertAtomicSteps(vehicleId, procedureId, steps) {
    if (!steps.length) return;
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await dbQuery(
            `INSERT INTO procedure_step
               (vehicle_id, source_article_id, step_index, procedure_id,
                operation_name, sequence_order, step_text,
                spec_data, safety_data, media_assets, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,now())
             ON CONFLICT (vehicle_id, source_article_id, step_index)
             DO UPDATE SET
               procedure_id   = EXCLUDED.procedure_id,
               operation_name = EXCLUDED.operation_name,
               sequence_order = EXCLUDED.sequence_order,
               step_text      = EXCLUDED.step_text,
               spec_data      = EXCLUDED.spec_data,
               safety_data    = EXCLUDED.safety_data,
               media_assets   = EXCLUDED.media_assets,
               updated_at     = now()`,
            [
                vehicleId,
                s.step_id,       // source_article_id holds Motor article id
                i,               // step_index
                procedureId,
                s.operation_name,
                s.sequence_order ?? i,
                s.operation_name, // step_text fallback
                JSON.stringify(s.spec_data ?? {}),
                JSON.stringify(s.safety_data ?? {}),
                JSON.stringify(s.media_assets ?? []),
            ]
        );
    }
}

/**
 * Fetch all atomic steps for a procedure, ordered by sequence_order.
 */
export async function getAtomicSteps(procedureId) {
    const { rows } = await dbQuery(
        `SELECT id, step_index, sequence_order, operation_name, step_text,
                spec_data, safety_data, media_assets, image_url, warning, note
         FROM procedure_step
         WHERE procedure_id = $1
         ORDER BY sequence_order NULLS LAST, step_index`,
        [procedureId]
    );
    return rows;
}

/**
 * Fetch a procedure by vehicle + external (Motor article) id.
 */
export async function getProcedureByArticleId(vehicleId, externalId) {
    const { rows } = await dbQuery(
        `SELECT id, title, description, content_html, steps, tools_required,
                parts_required, time_estimate_hours, cautions, category_id
         FROM procedures
         WHERE vehicle_id = $1 AND external_id = $2
         LIMIT 1`,
        [vehicleId, externalId]
    );
    return rows[0] ?? null;
}
