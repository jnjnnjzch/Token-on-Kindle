import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tauriVersion = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoPackage = cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLock = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), 'utf8');
const cargoLockPackage = cargoLock.match(/\[\[package\]\]\nname = "token-on-kindle"\nversion = "([^"]+)"/)?.[1];
const versionModule = fs.readFileSync(path.join(root, 'web', 'version.js'), 'utf8');
const webVersion = versionModule.match(/APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1];

const versions = {
  packageJson: packageVersion,
  tauriConfig: tauriVersion,
  cargoPackage,
  cargoLockPackage,
  webModule: webVersion
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1 || [...unique].some(value => !value)) {
  console.error('Version mismatch:', versions);
  process.exit(1);
}

console.log(`Version files are synchronized: ${packageVersion}`);
