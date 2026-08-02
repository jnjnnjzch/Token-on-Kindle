import fs from 'node:fs';
import path from 'node:path';

const raw = process.argv[2] || process.env.TOKEN_ON_KINDLE_VERSION;
if (!raw) {
  console.error('Usage: node tools/sync-version.mjs v0.3.1');
  process.exit(2);
}

const version = String(raw).trim().replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semantic version: ${raw}`);
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '..');

function updateJson(relativePath, updater) {
  const file = path.join(root, relativePath);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  updater(data);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

updateJson('package.json', data => { data.version = version; });
updateJson('src-tauri/tauri.conf.json', data => { data.version = version; });

const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const cargo = fs.readFileSync(cargoPath, 'utf8');
const packageStart = cargo.indexOf('[package]');
const nextSection = cargo.indexOf('\n[', packageStart + 1);
const packageEnd = nextSection === -1 ? cargo.length : nextSection;
const packageBlock = cargo.slice(packageStart, packageEnd);
if (!/^version\s*=\s*"[^"]+"/m.test(packageBlock)) {
  throw new Error('Could not find [package] version in Cargo.toml');
}
const updatedBlock = packageBlock.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, `${cargo.slice(0, packageStart)}${updatedBlock}${cargo.slice(packageEnd)}`);

const versionModule = `// Generated from the release tag / Cargo package version. Do not edit manually.\nexport const APP_VERSION = ${JSON.stringify(version)};\n`;
fs.writeFileSync(path.join(root, 'web', 'version.js'), versionModule);

console.log(`Synchronized Token on Kindle version: ${version}`);
