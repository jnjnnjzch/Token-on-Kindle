#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if token_on_kindle_lib::run_update_helper_from_args() {
        return;
    }
    token_on_kindle_lib::run();
}
