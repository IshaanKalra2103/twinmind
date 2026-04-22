"""Runtime configuration loaded from env vars.

`DATABASE_URL` is required in production (Cloud Run pulls it from Secret Manager).
In dev the default `.env` in `server/` feeds these values. The user-paste Groq key
is never stored here; see decision-002.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Environment ---------------------------------------------------
    env: str = Field(default="dev", description="dev | prod")

    # --- Database ------------------------------------------------------
    # Full asyncpg-compatible Postgres URL. In prod this is mounted from
    # Secret Manager. In dev, set it in server/.env or leave blank to skip
    # DB wiring (routes that hit the pool will 500, but /healthz works).
    database_url: str | None = Field(default=None)

    # --- CORS ----------------------------------------------------------
    allowed_origins: str = Field(
        default="http://localhost:3000",
        description="Comma-separated list of origins allowed by CORS.",
    )

    # --- Groq model ids ------------------------------------------------
    # VERIFY at implementation time — the brief specifies Whisper Large V3
    # (non-turbo) and GPT-OSS 120B. These are the current Groq model ids.
    model_transcribe: str = Field(default="whisper-large-v3")
    model_chat: str = Field(default="openai/gpt-oss-120b")

    # --- Prompt defaults ----------------------------------------------
    context_window_suggestions_chars: int = Field(default=4000)
    context_window_expanded_chars: int = Field(default=12000)
    context_window_chat_chars: int = Field(default=12000)
    chat_history_turns: int = Field(default=6)

    # --- Dev fallback --------------------------------------------------
    # Only used if ENV=dev and a request arrives without X-Groq-Api-Key.
    # Never used in prod.
    groq_api_key: str | None = Field(default=None)

    @property
    def allowed_origin_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
