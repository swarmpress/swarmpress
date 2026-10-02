use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

/// HTTP-facing error. Internal errors are logged and returned without detail.
/// Every error body is `{"error": "..."}`; a 422 adds `"issues": [...]`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not signed in")]
    Unauthorized,
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    PayloadTooLarge(String),
    #[error("{0}")]
    UnsupportedMediaType(String),
    /// The request is well formed but its content fails validation (a page
    /// that breaks the schema or the article profile). The body carries the
    /// individual problems: `{"error": "...", "issues": ["...", ...]}`.
    #[error("{message}")]
    Unprocessable {
        message: String,
        issues: Vec<String>,
    },
    /// A required precondition header (e.g. the company lease) is missing.
    #[error("{0}")]
    PreconditionRequired(String),
    #[error("{0}")]
    TooManyRequests(String),
    #[error("{0}")]
    NotImplemented(String),
    #[error("upstream error: {0}")]
    BadGateway(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    GatewayTimeout(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.into())
    }
}

impl AppError {
    pub fn status(&self) -> StatusCode {
        match self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::UnsupportedMediaType(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            AppError::Unprocessable { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::PreconditionRequired(_) => StatusCode::PRECONDITION_REQUIRED,
            AppError::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
            AppError::NotImplemented(_) => StatusCode::NOT_IMPLEMENTED,
            AppError::BadGateway(_) => StatusCode::BAD_GATEWAY,
            AppError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            AppError::GatewayTimeout(_) => StatusCode::GATEWAY_TIMEOUT,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let message = match &self {
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                "internal error".to_string()
            }
            other => other.to_string(),
        };
        let body = match &self {
            AppError::Unprocessable { issues, .. } => {
                serde_json::json!({ "error": message, "issues": issues })
            }
            _ => serde_json::json!({ "error": message }),
        };
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
