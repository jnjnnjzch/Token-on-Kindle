import fs from 'node:fs';

const path = 'tools/apply-v0.6.2-fix.mjs';
let source = fs.readFileSync(path, 'utf8');
const startMarker = "let workflow = read('.github/workflows/pipeline.yml');\n";
const endMarker = "write('.github/workflows/pipeline.yml', workflow);\n\n";
const start = source.indexOf(startMarker);
const endBase = source.indexOf(endMarker, start);
if (start < 0 || endBase < 0) throw new Error('workflow patch block not found');
source = source.slice(0, start) + source.slice(endBase + endMarker.length);
source = source.replace(
  "['tools/checkout-v0.6.2-fix.mjs', 'tools/apply-v0.6.2-fix.mjs']",
  "['tools/checkout-v0.6.2-fix.mjs', 'tools/drop-v0.6.2-workflow-patch.mjs', 'tools/apply-v0.6.2-fix.mjs']"
);
fs.writeFileSync(path, source, 'utf8');
