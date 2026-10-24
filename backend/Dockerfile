# syntax=docker/dockerfile:1.7

# ---- build: install dependencies into an isolated virtualenv ------------------
FROM python:3.13-slim AS builder
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install -r requirements.txt

# ---- runtime: slim image, no build tooling, non-root user ---------------------
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8000 \
    WEB_CONCURRENCY=2 \
    ENVIRONMENT=production

RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app main.py ./
COPY --chown=app:app app ./app
# The bundled January 2026 snapshot: the API is ready in under a second and
# does not depend on Elexon being up. data/ stays writable for DATA_MODE=live.
COPY --chown=app:app data ./data
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health/ready' % os.environ.get('PORT', '8000'), timeout=2)"]

# Shell form so $PORT and $WEB_CONCURRENCY (set by Heroku and similar platforms)
# are expanded at start-up. exec hands PID 1 to uvicorn for clean SIGTERM handling.
CMD exec uvicorn app.main:app \
    --host 0.0.0.0 --port "$PORT" \
    --workers "$WEB_CONCURRENCY" \
    --proxy-headers --forwarded-allow-ips "*" \
    --no-server-header \
    --timeout-graceful-shutdown 10
