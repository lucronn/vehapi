/**
 * Map PMSST (maintenance schedule) rows to Motor **labor catalog** ids (`L:…`).
 *
 * Motor returns `applicationID` on interval stubs — that is **not** the same id space as
 * `GET …/labor/L:123` (see M1: maintenance UI is display-only; labor uses `L:` from catalog).
 * When `taxonomyLiteralName` is present (merged from `body.applications`), match against
 * catalog `Labor` titles.
 */

export interface LaborCatalogArticleLike {
    id: string;
    title: string;
    bucket?: string;
    parentBucket?: string;
}

function norm(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isLaborBucket(bucket?: string, parentBucket?: string): boolean {
    const b = `${bucket || ''} ${parentBucket || ''}`.toLowerCase();
    return b.includes('labor');
}

function isGenericScheduleDescription(description: string): boolean {
    return /maintenance schedule\s+\d+\s+\(ref\s+\d+\)/i.test(description.trim());
}

/** Prefer Labor-bucket rows when scores tie. */
function sortLaborFirst<T extends LaborCatalogArticleLike>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
        const la = isLaborBucket(a.bucket, a.parentBucket) ? 0 : 1;
        const lb = isLaborBucket(b.bucket, b.parentBucket) ? 0 : 1;
        return la - lb;
    });
}

/**
 * Pick best `L:` article for a maintenance row from catalog search results or Supabase `articles`.
 */
export function pickLaborArticleFromCatalog(
    articles: LaborCatalogArticleLike[],
    taxonomyLiteralName: string,
    rowDescription: string
): { id: string; title: string } | null {
    const L = articles.filter((a) => typeof a.id === 'string' && a.id.startsWith('L:'));
    if (!L.length) return null;

    const lit = norm(taxonomyLiteralName);
    const desc = norm(rowDescription);
    const generic = isGenericScheduleDescription(rowDescription);

    if (lit) {
        const exact = L.find((a) => norm(a.title) === lit);
        if (exact) return { id: exact.id, title: exact.title };

        const sub = sortLaborFirst(
            L.filter((a) => {
                const t = norm(a.title);
                return t.includes(lit) || lit.includes(t);
            })
        );
        if (sub.length) return { id: sub[0].id, title: sub[0].title };

        const litWords = lit.split(/\s+/).filter((w) => w.length > 2);
        let best: { row: LaborCatalogArticleLike; n: number } | null = null;
        for (const a of L) {
            const words = norm(a.title)
                .split(/\s+/)
                .filter((w) => w.length > 2);
            const n = words.filter((w) => litWords.includes(w)).length;
            if (n > 0 && (!best || n > best.n)) best = { row: a, n };
        }
        if (best && best.n >= 2) return { id: best.row.id, title: best.row.title };
        if (best && best.n === 1 && litWords.length === 1) return { id: best.row.id, title: best.row.title };
    }

    if (!generic && desc.length > 8) {
        const hit = sortLaborFirst(L).find((a) => {
            const t = norm(a.title);
            return t.length > 3 && (desc.includes(t) || t.includes(desc.slice(0, Math.min(40, desc.length))));
        });
        if (hit) return { id: hit.id, title: hit.title };
    }

    return null;
}
