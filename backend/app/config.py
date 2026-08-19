from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    radarr_url: str = "http://10.0.0.154:7878"
    radarr_api_key: str = ""
    sonarr_url: str = "http://10.0.0.154:8989"
    sonarr_api_key: str = ""
    prowlarr_url: str = "http://10.0.0.154:9696"
    prowlarr_api_key: str = ""
    qbit_url: str = "http://10.0.0.154:8090"
    qbit_username: str = ""
    qbit_password: str = ""
    transmission_url: str = "http://10.0.0.154:9091"
    overseerr_url: str = "http://10.0.0.154:5055"
    overseerr_api_key: str = ""
    gluetun_url: str = "http://10.0.0.154:8029"
    gluetun_api_key: str = ""
    bazarr_url: str = "http://10.0.0.154:6767"
    bazarr_api_key: str = ""
    plex_url: str = "http://10.0.0.154:32400"
    plex_api_key: str = ""
    cors_origins: list[str] = ["*"]
    request_timeout: float = 8.0
    db_path: str = "data/arrdeck.db"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
