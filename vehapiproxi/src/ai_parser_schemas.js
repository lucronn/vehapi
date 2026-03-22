/**
 * Zod validation for Nemotron procedure extraction (L1 multi-procedure shape).
 * Quantities optional/nullable per OEM text gaps.
 */
import { z } from 'zod';

export const PartRequiredSchema = z.object({
    part_number: z.string().optional(),
    description: z.string(),
    quantity: z.coerce.number().nullable().optional()
});

export const StepSchema = z.object({
    order: z.coerce.number().optional().default(0),
    text: z.string(),
    image_url: z.string().optional(),
    warning: z.string().optional(),
    note: z.string().optional()
});

export const ProcedureSchema = z.object({
    title: z.coerce.string(),
    description: z.string().optional(),
    cautions: z.string().optional(),
    time_estimate_hours: z.number().nullable().optional(),
    tools_required: z.array(z.string()).optional(),
    parts_required: z.array(PartRequiredSchema).optional(),
    steps: z.array(StepSchema).min(1, 'Each procedure must have at least one step')
});

/** Root shape Nemotron returns before `collapseProceduresForL1`. */
export const ArticleExtractionSchema = z.object({
    article_title: z.string().optional(),
    article_description: z.string().optional(),
    procedures: z.array(ProcedureSchema).min(1, 'At least one procedure is required')
});

export function formatZodError(err) {
    if (!err || !err.issues) return String(err);
    return err.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
}
