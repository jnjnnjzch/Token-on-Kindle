import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(import.meta.dirname, '..', 'web', 'app.js');
let app = fs.readFileSync(appPath, 'utf8');
const invalid = "document.querySelector `#${source}-status`)";
const valid = "document.querySelector(`#${source}-status`)";

if (!app.includes(valid)) {
  if (!app.includes(invalid)) throw new Error('v0.7.0 app querySelector repair target is missing');
  app = app.replace(invalid, valid);
  fs.writeFileSync(appPath, app);
}

console.log('Verified v0.7.0 app querySelector syntax.');
