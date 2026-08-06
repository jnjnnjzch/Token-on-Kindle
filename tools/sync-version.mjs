import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packageJsonPath = path.join(root, 'package.json');
const packageVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
const raw = process.argv[2] || process.env.TOKEN_ON_KINDLE_VERSION || packageVersion;

const version = String(raw).trim().replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semantic version: ${raw}`);
  process.exit(2);
}

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

const cargoLockPath = path.join(root, 'src-tauri', 'Cargo.lock');
if (fs.existsSync(cargoLockPath)) {
  const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
  const packagePattern = /(\[\[package\]\]\nname = "token-on-kindle"\nversion = ")[^"]+("\n)/;
  if (!packagePattern.test(cargoLock)) {
    throw new Error('Could not find token-on-kindle package version in Cargo.lock');
  }
  fs.writeFileSync(cargoLockPath, cargoLock.replace(packagePattern, `$1${version}$2`));
}

const versionModule = `// Generated from the release tag / Cargo package version. Do not edit manually.\nexport const APP_VERSION = ${JSON.stringify(version)};\n`;
fs.writeFileSync(path.join(root, 'web', 'version.js'), versionModule);

console.log(`Synchronized Token on Kindle version: ${version}`);
