/**
 * One-shot Nemotron connectivity check. Loads ../.env — does not print API keys.
 * Usage: node scripts/check-nemotron.mjs
 */
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env') });

const { getNemotronClient, getNemotronApiKey, getNemotronTextModel, resolveNemotronBaseUrl } = await import(
    '../src/nemotron_client.js'
);

const hasKey = Boolean(getNemotronApiKey());
const baseUrl = resolveNemotronBaseUrl();
const model = getNemotronTextModel();

console.log('[nemotron-check] key configured:', hasKey);
console.log('[nemotron-check] base URL:', baseUrl);
console.log('[nemotron-check] text model:', model);

if (!hasKey) {
    console.error('[nemotron-check] FAIL: no NVIDIA_API_KEY / NVAPI_KEY / LLM_API_KEY');
    process.exit(1);
}

const client = getNemotronClient();
if (!client) {
    console.error('[nemotron-check] FAIL: client is null');
    process.exit(1);
}

try {
    // Nemotron 3 Super often returns final text only on the streaming path (same as ai_parser callAI).
    const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the two letters: ok' }],
        max_tokens: 256,
        temperature: 0.2,
        top_p: 0.95,
        reasoning_budget: 1024,
        chat_template_kwargs: { enable_thinking: true },
        stream: true
    });

    let fullContent = '';
    for await (const chunk of stream) {
        const d = chunk.choices[0]?.delta;
        if (d?.content) {
            fullContent += d.content;
        }
    }

    const text = fullContent.trim();
    console.log('[nemotron-check] response preview:', text.slice(0, 120).replace(/\s+/g, ' '));
    if (!text) {
        console.error('[nemotron-check] FAIL: empty streamed content');
        process.exit(1);
    }
    console.log('[nemotron-check] OK');
    process.exit(0);
} catch (e) {
    console.error('[nemotron-check] FAIL:', e.message || e);
    process.exit(1);
}
