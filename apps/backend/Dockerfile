# Cloud Run image for the aftercall API. Build context: apps/backend.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so code edits don't reinstall them. The empty package lets pip resolve pyproject.
COPY pyproject.toml ./
RUN mkdir aftercall && touch aftercall/__init__.py \
    && pip install . \
    && pip uninstall -y aftercall \
    && rm -rf aftercall build

COPY aftercall ./aftercall
RUN pip install --no-deps .

RUN useradd --system --no-create-home appuser
USER appuser

# Cloud Run sets PORT; settings come from its env vars and Secret Manager, not a .env file.
ENV PORT=8080
CMD exec uvicorn aftercall.api:app --host 0.0.0.0 --port "${PORT}" --proxy-headers --forwarded-allow-ips="*"
