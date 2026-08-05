#[cfg(target_os = "windows")]
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
    let staged = target_dir.join(format!(".{target_name}.{}.update.exe", std::process::id()));
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

    // The helper must be the downloaded new binary. Older installed versions do
    // not understand HELPER_MARKER, so copying current_exe would only relaunch
    // the old application instead of applying the update.
    fs::copy(source_exe, &helper).map_err(|error| format!("无法创建新版本更新助手：{error}"))?;
    append_log(
        &log_path,
        format!(
            "prepared new-version update helper; target={}, staged={}",
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
            format!("无法启动独立更新助手：{second_error}（首次尝试：{first_error}）")
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
            Err(restore_error) => {
                format!("无法放置新程序且恢复旧版本失败：{error}；恢复错误：{restore_error}")
            }
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
    append_log(&log_path, "new-version update helper started");

    let mut last_error = String::new();
    for attempt in 1..=240 {
        match replace_once(&staged, &target, &backup) {
            Ok(()) => {
                append_log(
                    &log_path,
                    format!("replacement succeeded on attempt {attempt}"),
                );
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
                append_log(
                    &log_path,
                    "replacement launched successfully; backup retained for rollback",
                );
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
    let Some((staged, target, work_dir)) = staged
        .zip(target)
        .zip(work_dir)
        .map(|((a, b), c)| (a, b, c))
    else {
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
