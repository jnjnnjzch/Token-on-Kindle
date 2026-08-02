import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = path => fs.readFileSync(path, 'utf8');
const write = (path, value) => fs.writeFileSync(path, value, 'utf8');
const replaceOnce = (value, before, after, label) => {
  const index = value.indexOf(before);
  if (index < 0) throw new Error(`Unable to patch ${label}`);
  if (value.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Patch target is ambiguous: ${label}`);
  }
  return value.slice(0, index) + after + value.slice(index + before.length);
};

const updaterModule = String.raw`#[cfg(target_os = "windows")]
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const HELPER_MARKER: &str = "--token-on-kindle-apply-update";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
#[cfg(target_os = "windows")]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;

#[cfg(target_os = "windows")]
fn append_log(path: &Path, message: impl AsRef<str>) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", message.as_ref());
    }
}

#[cfg(target_os = "windows")]
fn helper_command(
    helper: &Path,
    staged: &Path,
    target: &Path,
    work_dir: &Path,
    log_path: &Path,
    flags: u32,
) -> Result<std::process::Child, std::io::Error> {
    let stdout = File::options().create(true).append(true).open(log_path)?;
    let stderr = stdout.try_clone()?;
    let mut command = Command::new(helper);
    command
        .arg(HELPER_MARKER)
        .arg(staged)
        .arg(target)
        .arg(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .creation_flags(flags);
    command.spawn()
}

#[cfg(target_os = "windows")]
pub(crate) fn prepare_and_spawn(
    current_exe: &Path,
    source_exe: &Path,
    work_dir: &Path,
) -> Result<(), String> {
    let target_dir = current_exe
        .parent()
        .ok_or_else(|| "当前程序目录无效".to_string())?;
    let target_name = current_exe
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Token-on-Kindle.exe");
    let staged = target_dir.join(format!(
        ".{target_name}.{}.update.exe",
        std::process::id()
    ));
    let helper = work_dir.join("Token-on-Kindle-update-helper.exe");
    let log_path = work_dir.join("update.log");

    fs::copy(source_exe, &staged)
        .map_err(|error| format!("无法在程序目录预写入新版本：{error}"))?;
    let source_size = fs::metadata(source_exe)
        .map_err(|error| format!("无法读取更新程序大小：{error}"))?
        .len();
    let staged_size = fs::metadata(&staged)
        .map_err(|error| format!("无法读取预写入程序大小：{error}"))?
        .len();
    if source_size == 0 || source_size != staged_size {
        let _ = fs::remove_file(&staged);
        return Err("预写入的新版本不完整，已取消更新".into());
    }

    fs::copy(current_exe, &helper)
        .map_err(|error| format!("无法创建独立更新助手：{error}"))?;
    append_log(
        &log_path,
        format!(
            "prepared update helper; target={}, staged={}",
            current_exe.display(),
            staged.display()
        ),
    );

    let detached_flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB;
    match helper_command(
        &helper,
        &staged,
        current_exe,
        work_dir,
        &log_path,
        detached_flags,
    ) {
        Ok(_) => Ok(()),
        Err(first_error) => helper_command(
            &helper,
            &staged,
            current_exe,
            work_dir,
            &log_path,
            CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP,
        )
        .map(|_| ())
        .map_err(|second_error| {
            let _ = fs::remove_file(&staged);
            format!(
                "无法启动独立更新助手：{second_error}（首次尝试：{first_error}）"
            )
        }),
    }
}

#[cfg(target_os = "windows")]
fn replace_once(staged: &Path, target: &Path, backup: &Path) -> Result<(), String> {
    if backup.exists() {
        if target.exists() {
            fs::remove_file(backup).map_err(|error| format!("无法清理旧备份：{error}"))?;
        } else {
            fs::rename(backup, target)
                .map_err(|error| format!("无法先恢复上一次更新留下的旧版本：{error}"))?;
        }
    }
    fs::rename(target, backup).map_err(|error| format!("旧程序仍被占用：{error}"))?;
    if let Err(error) = fs::rename(staged, target) {
        let restore = fs::rename(backup, target);
        return Err(match restore {
            Ok(()) => format!("无法放置新程序，已恢复旧版本：{error}"),
            Err(restore_error) => format!(
                "无法放置新程序且恢复旧版本失败：{error}；恢复错误：{restore_error}"
            ),
        });
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn launch_replacement(target: &Path) -> Result<(), String> {
    let working_dir = target.parent().unwrap_or_else(|| Path::new("."));
    Command::new(target)
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("新版本已替换，但无法自动重新启动：{error}"))
}

#[cfg(target_os = "windows")]
fn run_helper(staged: PathBuf, target: PathBuf, work_dir: PathBuf) -> Result<(), String> {
    let log_path = work_dir.join("update.log");
    let backup = target.with_extension("exe.token-on-kindle-backup");
    append_log(&log_path, "update helper started");

    let mut last_error = String::new();
    for attempt in 1..=240 {
        match replace_once(&staged, &target, &backup) {
            Ok(()) => {
                append_log(&log_path, format!("replacement succeeded on attempt {attempt}"));
                if let Err(error) = launch_replacement(&target) {
                    append_log(&log_path, &error);
                    if target.exists() {
                        let _ = fs::remove_file(&target);
                    }
                    if backup.exists() {
                        let _ = fs::rename(&backup, &target);
                    }
                    return Err(error);
                }
                thread::sleep(Duration::from_millis(800));
                append_log(&log_path, "replacement launched successfully; backup retained for rollback");
                return Ok(());
            }
            Err(error) => {
                last_error = error;
                if attempt == 1 || attempt % 20 == 0 {
                    append_log(
                        &log_path,
                        format!("replacement attempt {attempt} pending: {last_error}"),
                    );
                }
                thread::sleep(Duration::from_millis(250));
            }
        }
    }
    Err(format!("等待旧程序退出超时：{last_error}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn run_from_args() -> bool {
    let mut args = std::env::args_os();
    let _program = args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new(HELPER_MARKER)) {
        return false;
    }
    let staged = args.next().map(PathBuf::from);
    let target = args.next().map(PathBuf::from);
    let work_dir = args.next().map(PathBuf::from);
    let Some((staged, target, work_dir)) = staged.zip(target).zip(work_dir).map(|((a, b), c)| (a, b, c)) else {
        return true;
    };
    let log_path = work_dir.join("update.log");
    if let Err(error) = run_helper(staged, target, work_dir) {
        append_log(&log_path, format!("update failed: {error}"));
    }
    true
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn run_from_args() -> bool {
    false
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::replace_once;
    use std::fs;

    #[test]
    fn replacement_moves_the_staged_binary_into_the_original_path() {
        let root = std::env::temp_dir().join(format!(
            "token-on-kindle-helper-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let target = root.join("Token-on-Kindle.exe");
        let staged = root.join("Token-on-Kindle.update.exe");
        let backup = root.join("Token-on-Kindle.backup.exe");
        fs::write(&target, b"old").unwrap();
        fs::write(&staged, b"new").unwrap();

        replace_once(&staged, &target, &backup).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert_eq!(fs::read(&backup).unwrap(), b"old");
        assert!(!staged.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
`;

write('src-tauri/src/update_helper.rs', updaterModule);

let main = read('src-tauri/src/main.rs');
main = replaceOnce(
  main,
  'fn main() {\n    token_on_kindle_lib::run();\n}\n',
  'fn main() {\n    if token_on_kindle_lib::run_update_helper_from_args() {\n        return;\n    }\n    token_on_kindle_lib::run();\n}\n',
  'Windows update helper entry point'
);
write('src-tauri/src/main.rs', main);

let rust = read('src-tauri/src/lib.rs');
rust = replaceOnce(
  rust,
  '    process::{Command, Stdio},\n',
  '    process::Command,\n',
  'unused Stdio import'
);
rust = replaceOnce(
  rust,
  'mod desktop;\n',
  'mod desktop;\nmod update_helper;\n\npub fn run_update_helper_from_args() -> bool {\n    update_helper::run_from_args()\n}\n',
  'update helper module registration'
);
const replacementStart = '    let replace_script = temp_root.join("replace-and-restart.ps1");\n';
const replacementEnd = '        .map_err(|error| format!("无法启动更新替换进程：{error}"))?;\n';
const startIndex = rust.indexOf(replacementStart);
const endIndexBase = rust.indexOf(replacementEnd, startIndex);
if (startIndex < 0 || endIndexBase < 0) throw new Error('Unable to locate legacy PowerShell replacement block');
const endIndex = endIndexBase + replacementEnd.length;
rust = rust.slice(0, startIndex)
  + '    update_helper::prepare_and_spawn(&current_exe, &source_exe, &temp_root)?;\n'
  + rust.slice(endIndex);
write('src-tauri/src/lib.rs', rust);

let desktopRust = read('src-tauri/src/desktop.rs');
desktopRust = replaceOnce(
  desktopRust,
  '    app.state::<DesktopState>().tray_available.store(true, Ordering::Relaxed);\n    let _ = tray.set_tooltip(Some("Token on Kindle · 托盘已就绪"));\n',
  '    app.state::<DesktopState>().tray_available.store(true, Ordering::Relaxed);\n    let _ = app.handle().emit_to("main", "desktop-state-changed", info(app.handle()));\n    let _ = tray.set_tooltip(Some("Token on Kindle · 托盘已就绪"));\n',
  'tray ready event'
);
write('src-tauri/src/desktop.rs', desktopRust);

let desktopJs = read('web/desktop.js');
desktopJs = replaceOnce(
  desktopJs,
  'await loadDesktopState();\nscheduleTraySync();\n',
  'await loadDesktopState();\nsetTimeout(loadDesktopState, 600);\nsetTimeout(loadDesktopState, 1800);\nscheduleTraySync();\n',
  'tray startup state retry'
);
write('web/desktop.js', desktopJs);

let updateJs = read('web/update.js');
updateJs = replaceOnce(
  updateJs,
  '  setBusy(true);\n  setStatus(`正在下载 ${latest} 并校验 SHA-256…`, \'available\');\n  try {\n',
  '  setBusy(true);\n  setStatus(`正在下载 ${latest} 并校验 SHA-256…`, \'available\');\n  localStorage.setItem(\'token-on-kindle:pending-update\', latest);\n  try {\n',
  'pending update marker'
);
updateJs = replaceOnce(
  updateJs,
  '  } catch (error) {\n    setBusy(false);\n    setStatus(`自动更新失败：${error}`, \'error\');\n  }\n}\n',
  '  } catch (error) {\n    localStorage.removeItem(\'token-on-kindle:pending-update\');\n    setBusy(false);\n    setStatus(`自动更新失败：${error}`, \'error\');\n  }\n}\n',
  'failed update marker cleanup'
);
updateJs = replaceOnce(
  updateJs,
  'document.querySelector(\'#installed-version\').textContent = `当前 ${APP_VERSION}`;\nif (shouldAutoCheck()) setTimeout(() => checkForUpdates(), 2500);\n',
  'document.querySelector(\'#installed-version\').textContent = `当前 ${APP_VERSION}`;\nconst pendingUpdate = localStorage.getItem(\'token-on-kindle:pending-update\');\nif (pendingUpdate && compareVersions(APP_VERSION, pendingUpdate) >= 0) {\n  localStorage.removeItem(\'token-on-kindle:pending-update\');\n  setStatus(`更新成功 · 当前 ${APP_VERSION}`, \'ok\');\n} else if (shouldAutoCheck()) {\n  setTimeout(() => checkForUpdates(), 2500);\n}\n',
  'successful update confirmation'
);
write('web/update.js', updateJs);

const contractTest = String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lib = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const helper = fs.readFileSync('src-tauri/src/update_helper.rs', 'utf8');
const main = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const desktopRust = fs.readFileSync('src-tauri/src/desktop.rs', 'utf8');
const desktopJs = fs.readFileSync('web/desktop.js', 'utf8');
const updateJs = fs.readFileSync('web/update.js', 'utf8');

test('Windows updater uses an independent executable helper instead of a silent post-exit PowerShell script', () => {
  assert.match(main, /run_update_helper_from_args/);
  assert.match(lib, /update_helper::prepare_and_spawn/);
  assert.doesNotMatch(lib, /replace-and-restart\.ps1/);
  assert.doesNotMatch(lib, /Wait-Process/);
  assert.match(helper, /Token-on-Kindle-update-helper\.exe/);
  assert.match(helper, /CREATE_NEW_PROCESS_GROUP/);
  assert.match(helper, /CREATE_BREAKAWAY_FROM_JOB/);
});

test('updater preflights the target directory and performs recoverable replacement', () => {
  assert.match(helper, /无法在程序目录预写入新版本/);
  assert.match(helper, /fs::rename\(target, backup\)/);
  assert.match(helper, /fs::rename\(staged, target\)/);
  assert.match(helper, /已恢复旧版本/);
  assert.match(helper, /update\.log/);
});

test('tray readiness is pushed after native tray creation and re-read by the UI', () => {
  assert.match(desktopRust, /tray_available\.store\(true/);
  assert.match(desktopRust, /desktop-state-changed/);
  assert.match(desktopJs, /setTimeout\(loadDesktopState, 600\)/);
  assert.match(desktopJs, /setTimeout\(loadDesktopState, 1800\)/);
});

test('the UI confirms a completed update only after the restarted binary reports the requested version', () => {
  assert.match(updateJs, /pending-update/);
  assert.match(updateJs, /compareVersions\(APP_VERSION, pendingUpdate\) >= 0/);
  assert.match(updateJs, /更新成功/);
});
`;
write('tests/update-helper-contract.test.mjs', contractTest);

let workflow = read('.github/workflows/pipeline.yml');
workflow = replaceOnce(
  workflow,
  '      - name: Build portable executable\n        run: npm run build -- --no-bundle\n',
  '      - name: Run Windows updater unit tests\n        run: cargo test --manifest-path src-tauri/Cargo.toml --lib\n      - name: Build portable executable\n        run: npm run build -- --no-bundle\n',
  'Windows updater unit tests in CI'
);
write('.github/workflows/pipeline.yml', workflow);

let readme = read('README.md');
readme = replaceOnce(
  readme,
  '## v0.6.1\n',
  '## v0.6.2\n\n- Windows 自动更新改用独立 EXE 更新助手，不再依赖退出后的静默 PowerShell 替换脚本。\n- 更新前先确认当前 EXE 所在目录可写；替换失败会恢复旧版本并保留 update.log。\n- 重启后只有嵌入版本确实达到目标版本，界面才显示“更新成功”。\n- 修复系统托盘已显示但“任务栏与后台”仍显示托盘不可用的启动时序问题。\n\n## v0.6.1\n',
  'v0.6.2 release notes'
);
write('README.md', readme);

execFileSync(process.execPath, ['tools/sync-version.mjs', '0.6.2'], { stdio: 'inherit' });

const packagePath = 'package.json';
const pkg = JSON.parse(read(packagePath));
pkg.scripts.test = pkg.scripts.test
  .replace('node tools/checkout-v0.6.2-fix.mjs && ', '')
  .replace('node tools/apply-v0.6.2-fix.mjs && ', '');
write(packagePath, JSON.stringify(pkg, null, 2) + '\n');

for (const path of ['tools/checkout-v0.6.2-fix.mjs', 'tools/apply-v0.6.2-fix.mjs']) {
  if (fs.existsSync(path)) fs.rmSync(path);
}

if (process.env.GITHUB_ACTIONS === 'true') {
  execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
  execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  execFileSync('git', ['add', '-A']);
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (status.trim()) {
    execFileSync('git', ['commit', '-m', 'Fix Windows updater replacement and tray readiness'], { stdio: 'inherit' });
    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
    execFileSync('git', ['push', 'origin', `HEAD:${branch}`], { stdio: 'inherit' });
  }
}
