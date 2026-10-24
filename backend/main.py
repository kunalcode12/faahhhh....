"""Convenience entrypoint so `uvicorn main:app` works from the backend folder.

The application itself lives in `app/main.py`.
"""

from app.main import app

__all__ = ["app"]
