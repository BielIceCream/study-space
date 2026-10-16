use std::fmt;

#[derive(Debug)]
pub enum StoreError {
    Invalid(String),
    NotFound(&'static str),
    Conflict,
    Database(rusqlite::Error),
    Json(serde_json::Error),
    Io(std::io::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound(entity) => write!(f, "{entity} não está disponível. Recarregue a biblioteca."),
            Self::Conflict => write!(f, "Esta nota foi modificada em outra janela. Seu texto continua no editor; copie-o antes de recarregar a nota."),
            Self::Database(_) => write!(f, "Não foi possível acessar o banco local. Verifique o espaço em disco e se outro aplicativo está bloqueando o arquivo; depois tente novamente."),
            Self::Json(_) => write!(f, "O documento contém dados JSON inválidos."),
            Self::Io(_) => write!(f, "Não foi possível abrir a pasta de dados do StudySpace. Verifique as permissões e o espaço em disco."),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub type StoreResult<T> = Result<T, StoreError>;
