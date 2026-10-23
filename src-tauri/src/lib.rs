mod error;
mod models;
mod storage;
mod validation;
mod jarvis_credentials;
mod materials;
mod backup_archive;
mod recovery;
mod study;
mod planner;
mod review_schedule;
mod error_notebook;
mod jarvis_ai;
mod jarvis_voice;

use error::StoreResult;
use models::*;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    connection: Mutex<Connection>,
    archive_sessions: Mutex<backup_archive::ArchiveSessions>,
}

fn with_connection<T>(state: State<'_, AppState>, operation: impl FnOnce(&mut Connection) -> StoreResult<T>) -> Result<T, String> {
    let mut connection = state.connection.lock()
        .map_err(|_| "O banco local está indisponível. Feche e reabra o StudySpace.".to_owned())?;
    operation(&mut connection).map_err(|error| error.to_string())
}

// Async commands run off the window thread. The mutex is never held across an await.
#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    with_connection(state, storage::get_snapshot)
}

#[tauri::command]
async fn create_subject(state: State<'_, AppState>, input: SubjectInput) -> Result<Subject, String> {
    with_connection(state, |connection| storage::create_subject(connection, input))
}

#[tauri::command]
async fn update_subject(state: State<'_, AppState>, id: String, input: SubjectInput) -> Result<Subject, String> {
    with_connection(state, |connection| storage::update_subject(connection, &id, input))
}

#[tauri::command]
async fn create_note(state: State<'_, AppState>, input: NoteInput) -> Result<Note, String> {
    with_connection(state, |connection| storage::create_note(connection, input))
}

#[tauri::command]
async fn save_note(state: State<'_, AppState>, input: SaveNoteInput) -> Result<Note, String> {
    with_connection(state, |connection| storage::save_note(connection, input))
}

#[tauri::command]
async fn save_study_track(state: State<'_, AppState>, input: study::SaveStudyTrackInput) -> Result<study::StudyTrack, String> {
    with_connection(state, |connection| storage::save_study_track(connection, input))
}

#[tauri::command]
async fn save_study_planner(state: State<'_, AppState>, input: planner::SaveStudyPlannerInput) -> Result<planner::StudyPlanner, String> {
    with_connection(state, |connection| storage::save_study_planner(connection, input))
}

#[tauri::command]
async fn save_error_entry(state: State<'_, AppState>, input: error_notebook::SaveErrorEntryInput) -> Result<error_notebook::ErrorEntry, String> {
    with_connection(state, |connection| storage::save_error_entry(connection, input))
}

#[tauri::command]
async fn create_flashcard(state: State<'_, AppState>, input: FlashcardInput) -> Result<Flashcard, String> {
    with_connection(state, |connection| storage::create_flashcard(connection, input))
}

#[tauri::command]
async fn update_flashcard(state: State<'_, AppState>, input: UpdateFlashcardInput) -> Result<Flashcard, String> {
    with_connection(state, |connection| storage::update_flashcard(connection, input))
}

#[tauri::command]
async fn record_review(state: State<'_, AppState>, input: ReviewInput) -> Result<ReviewLog, String> {
    with_connection(state, |connection| storage::record_review(connection, input))
}

#[tauri::command]
async fn set_theme(state: State<'_, AppState>, theme: Theme) -> Result<(), String> {
    with_connection(state, |connection| storage::set_theme(connection, theme))
}

#[tauri::command]
async fn export_backup(state: State<'_, AppState>) -> Result<BackupDocument, String> {
    with_connection(state, storage::export_backup)
}

#[tauri::command]
async fn restore_backup(state: State<'_, AppState>, backup: BackupDocument) -> Result<(), String> {
    with_connection(state, |connection| storage::restore_backup(connection, backup))
}

fn with_archive<T>(state: State<'_, AppState>, operation: impl FnOnce(&mut backup_archive::ArchiveSessions, &mut Connection) -> StoreResult<T>) -> Result<T, String> {
    let mut connection = state.connection.lock().map_err(|_| "O banco local está indisponível.".to_owned())?;
    let mut sessions = state.archive_sessions.lock().map_err(|_| "A sessão de backup está indisponível. Reabra o StudySpace.".to_owned())?;
    operation(&mut sessions, &mut connection).map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_backup_v3_begin(state: State<'_, AppState>) -> Result<backup_archive::ExportStart, String> {
    with_archive(state, |sessions, connection| sessions.export_begin(connection))
}

#[tauri::command]
async fn list_recovery_copies(state: State<'_, AppState>) -> Result<Vec<recovery::RecoveryMetadata>, String> {
    with_connection(state, |connection| recovery::list(connection))
}

#[tauri::command]
async fn export_recovery_v3_begin(state: State<'_, AppState>, id: String) -> Result<backup_archive::ExportStart, String> {
    with_archive(state, |sessions, connection| recovery::export_begin(connection, sessions, &id))
}

#[tauri::command]
async fn export_backup_v3_material(state: State<'_, AppState>, token: String, index: usize) -> Result<String, String> {
    with_archive(state, |sessions, _| sessions.export_material(&token, index))
}

#[tauri::command]
async fn restore_backup_v3_begin(state: State<'_, AppState>, manifest: backup_archive::ArchiveManifest) -> Result<String, String> {
    with_archive(state, |sessions, _| sessions.restore_begin(manifest))
}

#[tauri::command]
async fn restore_backup_v3_material(state: State<'_, AppState>, token: String, index: usize, data_base64: String) -> Result<(), String> {
    with_archive(state, |sessions, _| sessions.restore_material(&token, index, data_base64))
}

#[tauri::command]
async fn restore_backup_v3_finish(state: State<'_, AppState>, token: String) -> Result<(), String> {
    with_archive(state, |sessions, connection| sessions.restore_finish(connection, &token))
}

#[tauri::command]
async fn backup_v3_cancel(state: State<'_, AppState>, token: String) -> Result<(), String> {
    with_archive(state, |sessions, _| { sessions.cancel(&token); Ok(()) })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory).map_err(error::StoreError::from)?;
            let connection = storage::open(&directory.join("studyspace.sqlite3"))?;
            app.manage(AppState { connection: Mutex::new(connection), archive_sessions: Mutex::new(backup_archive::ArchiveSessions::default()) });
            app.manage(jarvis_ai::JarvisAiState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot, create_subject, update_subject, create_note, save_note,
            create_flashcard, update_flashcard, record_review, set_theme, save_study_track, save_study_planner, save_error_entry,
            export_backup, restore_backup,
            list_recovery_copies, export_recovery_v3_begin,
            export_backup_v3_begin, export_backup_v3_material, restore_backup_v3_begin,
            restore_backup_v3_material, restore_backup_v3_finish, backup_v3_cancel,
            jarvis_set_api_key, jarvis_has_api_key, jarvis_clear_api_key,
            import_batch, get_document, get_asset,
            jarvis_ai::jarvis_list_models, jarvis_ai::jarvis_test_connection, jarvis_ai::jarvis_chat,
            jarvis_ai::jarvis_transcribe, jarvis_ai::jarvis_cancel_request,
            jarvis_voice::jarvis_list_voices, jarvis_voice::jarvis_synthesize
        ])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o StudySpace com seu banco de dados local.");
}

#[tauri::command]
async fn import_batch(state:State<'_,AppState>,input:materials::ImportBatch)->Result<materials::ImportResult,String>{with_connection(state,|c|materials::import_batch(c,input))}
#[tauri::command]
async fn get_document(state:State<'_,AppState>,id:String)->Result<materials::StoredDocument,String>{with_connection(state,|c|materials::get_document(c,&id))}
#[tauri::command]
async fn get_asset(state:State<'_,AppState>,sha256:String)->Result<materials::Asset,String>{with_connection(state,|c|materials::get_asset(c,&sha256))}

#[tauri::command]
async fn jarvis_set_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), String> {
    jarvis_credentials::set_api_key(&app.config().identifier, api_key)
}

#[tauri::command]
async fn jarvis_has_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    jarvis_credentials::has_api_key(&app.config().identifier)
}

#[tauri::command]
async fn jarvis_clear_api_key(app: tauri::AppHandle) -> Result<(), String> {
    jarvis_credentials::clear_api_key(&app.config().identifier)
}
