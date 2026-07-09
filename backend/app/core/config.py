from functools import lru_cache
import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.PROJECT_NAME = os.getenv("PROJECT_NAME", "StudySense")
        self.API_V1_STR = os.getenv("API_V1_STR", "/api/v1")
        self.DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")
        self.SECRET_KEY = os.getenv("SECRET_KEY", "study-sense-dev-secret")
        self.ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
        self.OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
        self.PLANNER_AGENT_MODEL = os.getenv("PLANNER_AGENT_MODEL", "gpt-4o-mini")
        self.TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()
