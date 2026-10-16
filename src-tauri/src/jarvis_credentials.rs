// The API key stays in Windows Credential Manager, outside SQLite and backups.
// No IPC command returns its value. The AI adapter must use it inside Rust.
use zeroize::Zeroizing;

const INVALID_KEY: &str = "Informe uma chave válida, com até 2048 bytes e sem quebras de linha.";

fn validate(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 2048 || value.contains(['\0', '\r', '\n']) {
        return Err(INVALID_KEY.into());
    }
    Ok(value)
}

#[cfg(windows)]
fn entry(app_identifier: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(&format!("{app_identifier}.jarvis"), "api-key")
        .map_err(|_| "O Gerenciador de Credenciais do Windows está indisponível.".into())
}

#[cfg(windows)]
pub fn set_api_key(app_identifier: &str, api_key: String) -> Result<(), String> {
    let secret = Zeroizing::new(api_key);
    let value = validate(&secret)?;
    entry(app_identifier)?.set_password(value)
        .map_err(|_| "Não foi possível guardar a chave no Gerenciador de Credenciais do Windows.".into())
}

#[cfg(windows)]
pub fn read_api_key(app_identifier: &str) -> Result<Option<Zeroizing<String>>, String> {
    match entry(app_identifier)?.get_password() {
        Ok(value) => Ok(Some(Zeroizing::new(value))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Não foi possível acessar a credencial do JARVIS no Windows.".into()),
    }
}

#[cfg(windows)]
pub fn has_api_key(app_identifier: &str) -> Result<bool, String> { Ok(read_api_key(app_identifier)?.is_some()) }

#[cfg(windows)]
pub fn clear_api_key(app_identifier: &str) -> Result<(), String> {
    match entry(app_identifier)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Não foi possível remover a credencial do JARVIS no Windows.".into()),
    }
}

#[cfg(not(windows))]
pub fn set_api_key(_app_identifier: &str, api_key: String) -> Result<(), String> {
    let secret = Zeroizing::new(api_key);
    validate(&secret)?;
    Err("O armazenamento de credenciais do JARVIS requer Windows.".into())
}
#[cfg(not(windows))]
pub fn read_api_key(_app_identifier: &str) -> Result<Option<Zeroizing<String>>, String> { Err("O armazenamento de credenciais do JARVIS requer Windows.".into()) }
#[cfg(not(windows))]
pub fn has_api_key(_app_identifier: &str) -> Result<bool, String> { Err("O armazenamento de credenciais do JARVIS requer Windows.".into()) }
#[cfg(not(windows))]
pub fn clear_api_key(_app_identifier: &str) -> Result<(), String> { Err("O armazenamento de credenciais do JARVIS requer Windows.".into()) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_keys_without_echoing_secret() {
        for value in ["", "   ", "secret\ninside", "secret\0inside"] {
            assert_eq!(validate(value).unwrap_err(), INVALID_KEY);
        }
        assert!(validate(&"x".repeat(2049)).is_err());
        assert_eq!(validate("  example-test-key  ").unwrap(), "example-test-key");
    }

    #[cfg(windows)]
    #[test]
    fn windows_vault_round_trip_uses_an_isolated_test_credential() {
        let name = format!("studyspace-test-{}", uuid::Uuid::new_v4());
        let credential = keyring::Entry::new("app.studyspace.desktop.e2e", &name).unwrap();
        struct Cleanup(keyring::Entry);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = self.0.delete_credential(); } }
        let cleanup = Cleanup(credential);
        assert!(matches!(cleanup.0.get_password(), Err(keyring::Error::NoEntry)));
        cleanup.0.set_password("only-an-isolated-test-value").unwrap();
        let secret = Zeroizing::new(cleanup.0.get_password().unwrap());
        assert_eq!(secret.as_str(), "only-an-isolated-test-value");
        cleanup.0.delete_credential().unwrap();
        assert!(matches!(cleanup.0.get_password(), Err(keyring::Error::NoEntry)));
    }
}
