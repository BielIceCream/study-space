fn main() {
    println!("cargo:rerun-if-changed=../db/migrations/001_initial.sql");
    tauri_build::build();
}
