/**
 * JSON Schema definitions for AtomicStep and LogicNode.
 * Used by the normalization pipeline to validate extractor output before DB insert.
 *
 * Validation helper: validateAtomicStep(obj), validateLogicNode(obj)
 * Returns { valid: bool, errors: string[] }
 */

// ─── AtomicStep ──────────────────────────────────────────────────────────────

export const ATOMIC_STEP_SCHEMA = {
    type: 'object',
    required: ['step_id', 'operation_name', 'sequence_order'],
    properties: {
        step_id:        { type: 'string', format: 'uuid' },
        operation_name: { type: 'string', minLength: 1 },
        sequence_order: { type: 'integer', minimum: 0 },
        spec_data: {
            type: 'object',
            properties: {
                torque_nm:      { type: 'number' },
                torque_ft_lbs:  { type: 'number' },
                clearance_mm:   { type: 'number' },
                tool_ids:       { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: true,
        },
        safety_data: {
            type: 'object',
            properties: {
                warnings:      { type: 'array', items: { type: 'string' } },
                ppe_required:  { type: 'array', items: { type: 'string' } },
                caution_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            },
            additionalProperties: true,
        },
        media_assets: {
            type: 'array',
            items: {
                type: 'object',
                required: ['url', 'type'],
                properties: {
                    url:     { type: 'string' },
                    type:    { type: 'string', enum: ['image', 'diagram', 'video'] },
                    caption: { type: 'string' },
                },
            },
        },
    },
};

// ─── LogicNode ───────────────────────────────────────────────────────────────

export const LOGIC_NODE_SCHEMA = {
    type: 'object',
    required: ['node_id', 'node_type'],
    properties: {
        node_id:   { type: 'string', format: 'uuid' },
        node_type: { type: 'string', enum: ['decision', 'measurement', 'terminal_action'] },
        input_criteria: {
            type: 'object',
            properties: {
                dtc_code:       { type: 'string' },
                expected_range: {
                    type: 'object',
                    properties: {
                        min: { type: 'number' },
                        max: { type: 'number' },
                        unit: { type: 'string' },
                    },
                },
            },
            additionalProperties: true,
        },
        edges: {
            type: 'array',
            items: {
                type: 'object',
                required: ['condition', 'next_node_id'],
                properties: {
                    condition:   { type: 'string', minLength: 1 },
                    next_node_id: { type: 'string', format: 'uuid' },
                },
            },
        },
    },
};

// ─── Lightweight structural validator (no external deps) ─────────────────────

function validateAgainstSchema(obj, schema, path = '') {
    const errors = [];

    if (schema.type) {
        const actualType = Array.isArray(obj) ? 'array' : typeof obj;
        const typeOk = actualType === schema.type ||
            (schema.type === 'integer' && Number.isInteger(obj));
        if (!typeOk) {
            errors.push(`${path || 'root'}: expected ${schema.type}, got ${actualType}`);
            return errors;
        }
    }

    if (schema.required) {
        for (const key of schema.required) {
            if (obj == null || !(key in obj)) {
                errors.push(`${path}.${key}: required field missing`);
            }
        }
    }

    if (schema.enum && !schema.enum.includes(obj)) {
        errors.push(`${path || 'root'}: must be one of [${schema.enum.join(', ')}], got "${obj}"`);
    }

    if (schema.minimum != null && typeof obj === 'number' && obj < schema.minimum) {
        errors.push(`${path || 'root'}: ${obj} < minimum ${schema.minimum}`);
    }

    if (schema.minLength != null && typeof obj === 'string' && obj.length < schema.minLength) {
        errors.push(`${path || 'root'}: string too short (${obj.length} < ${schema.minLength})`);
    }

    if (schema.properties && obj && typeof obj === 'object') {
        for (const [key, subSchema] of Object.entries(schema.properties)) {
            if (key in obj && obj[key] != null) {
                errors.push(...validateAgainstSchema(obj[key], subSchema, `${path}.${key}`));
            }
        }
    }

    if (schema.type === 'array' && Array.isArray(obj) && schema.items) {
        for (let i = 0; i < obj.length; i++) {
            errors.push(...validateAgainstSchema(obj[i], schema.items, `${path}[${i}]`));
        }
    }

    return errors;
}

export function validateAtomicStep(obj) {
    const errors = validateAgainstSchema(obj, ATOMIC_STEP_SCHEMA);
    return { valid: errors.length === 0, errors };
}

export function validateLogicNode(obj) {
    const errors = validateAgainstSchema(obj, LOGIC_NODE_SCHEMA);
    return { valid: errors.length === 0, errors };
}
