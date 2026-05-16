import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { GoogleGenAI } from '@google/genai';
import { dbQuery } from '../src/db.js';

const ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: 'us-central1' });
const { rows } = await dbQuery('SELECT external_id, year, make, model FROM vehicles ORDER BY make');
const knownList = rows.map(v => `${v.year} ${v.make} ${v.model} [id: ${v.external_id}]`).join('\n');

const tests = [
  { label: 'Honda Civic oil change',  text: 'Oil filter replacement for 2010 Honda Civic. Part 15400-PLM-A02. Use 5W-20.' },
  { label: 'Unknown Tesla',           text: 'Brake pad replacement on 2022 Tesla Model 3. Remove caliper bolts.' },
  { label: 'No vehicle info',         text: 'Step 1: Remove drain plug. Step 2: Drain oil. Step 3: Replace filter.' },
  { label: 'Mercedes C350 TSB',       text: 'TSB 2010-14: Transmission shudder. Applies to 2010 Mercedes-Benz C350 4MATIC.' },
  { label: 'Multiple vehicles',       text: 'This TSB applies to 2010 Honda Civic and 2010 Nissan Altima with QR25DE engine.' },
];

console.log('Known vehicles:', knownList, '\n');

for (const { label, text } of tests) {
  const prompt = `You are an automotive data attribution expert. Identify which vehicle(s) this content belongs to.
KNOWN VEHICLES IN DATABASE:\n${knownList}
CONTENT: ${text}
Return ONLY JSON: {"vehicles":[{"year":number,"make":string,"model":string,"confidence":"high|medium|low","reasoning":"brief","matchedDbId":"exact_id_or_null"}],"coversMultipleVehicles":false,"overallConfidence":"high|medium|low","cannotDetermine":false,"cannotDetermineReason":null}`;

  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0 },
  });
  const r = JSON.parse(resp.candidates[0].content.parts[0].text);
  console.log(`[${label}]`);
  if (r.cannotDetermine) {
    console.log(`  → Cannot determine: ${r.cannotDetermineReason}`);
  } else {
    r.vehicles?.forEach(v => {
      const inDb = rows.some(row => row.external_id === v.matchedDbId);
      console.log(`  ${v.year} ${v.make} ${v.model} | confidence:${v.confidence} | matchedId:${v.matchedDbId||'none'} | inDB:${inDb}`);
      console.log(`  reason: ${v.reasoning}`);
    });
  }
  if (r.coversMultipleVehicles) console.log(`  ⚠ Covers multiple vehicles`);
  console.log();
}
process.exit(0);
