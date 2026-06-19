"""
Configuration module for L&T IPMS Conversational App
Loads settings from environment variables
"""

from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # Database
    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"
    S3_DEFAULT_BUCKET: str = "ewms-invoices"
    # LLM Configuration
    BASE_URL: str ="http://192.168.10.100:8000"  # Base URL for the API
    LLM_MODEL: str = "local-model"  # Model name for OpenAI-compatible API
    LLM_TEMPERATURE: float = 0.7
    LLM_MAX_TOKENS: int = 2048
    OCR_JOB_TIMEOUT_SECONDS: int = 0
    OCR_MAX_REQUEST_ENCODED_BYTES: int = 27 * 1024 * 1024
    OCR_API_URL: str = "https://openrouter.ai/api/v1/chat/completions"
    OCR_GEMINI_HTTP_TIMEOUT_SECONDS: int = 900
    OCR_GEMINI_MAX_ATTEMPTS: int = 7
    OCR_GEMINI_RETRY_BACKOFF_SECONDS: float = 2.0
    DOC_CLASSIFIER_API_KEY: str = ""
    DOC_CLASSIFIER_API_URL: str = ""
    DOC_CLASSIFIER_MODEL: str = ""
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_API_URL: str = "https://openrouter.ai/api/v1/chat/completions"
    OPENROUTER_MODEL_PRO: str = ""
    API_KEY: str = ""
    MODEL: str = ""
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    API_SLUG: str = "/api/v1"
    SECRET_KEY: str = "dev-secret-key"
    SESSION_COOKIE_SECURE: bool = False
    SESSION_COOKIE_SAMESITE: str = "lax"
    SESSION_COOKIE_DOMAIN: str = ""
    
    # Cache settings
    CACHE_TTL_SECONDS: int = 3600  # 1 hour default TTL for cached messages
    
    # API settings
    API_TITLE: str = "Invoice Extraction API"
    API_VERSION: str = "1.0.0"

    # Keycloak settings
    KEYCLOAK_URL: str = "http://localhost:8031"
    KEYCLOAK_ADMIN_USERNAME: str = "admin"
    KEYCLOAK_ADMIN_PASSWORD: str = "admin"
    KEYCLOAK_CLIENT_ID: str = "ewms-backend"
    KEYCLOAK_CLIENT_SECRET: str = ""
    KEYCLOAK_REALM: str = "ewms-saas"
    
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()


# Export singleton for easy access
settings = get_settings()
