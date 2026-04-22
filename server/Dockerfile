# Authoritative config: decision-009-gcp-cloud-run.md
FROM python:3.12-slim

WORKDIR /app

# uv ships as a single binary; keep the layer minimal.
RUN pip install --no-cache-dir uv

# Resolve deps first for better layer caching.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Then the app source.
COPY app ./app

ENV PORT=8080
EXPOSE 8080

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
