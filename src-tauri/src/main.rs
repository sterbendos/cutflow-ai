// CutFlow AI — main.rs
// Thin binary entry point that delegates to the library crate.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cutflow_ai_lib::run()
}
