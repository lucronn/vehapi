/**
 * Writes documentation/vehapiproxi-openapi.yaml from vehapiproxi/src/swagger.json
 * Run: node scripts/export-vehapiproxi-openapi.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yamljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'vehapiproxi', 'src', 'swagger.json');
const out = path.join(root, 'documentation', 'vehapiproxi-openapi.yaml');

const doc = JSON.parse(fs.readFileSync(src, 'utf8'));
const yaml = YAML.stringify(doc, 12);
fs.writeFileSync(out, `# Generated from vehapiproxi/src/swagger.json — do not edit by hand.\n# Regenerate: node scripts/export-vehapiproxi-openapi.mjs\n\n${yaml}`, 'utf8');
console.log(`Wrote ${path.relative(root, out)}`);
