# --- Stage 1: frontend build ---
FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# --- Stage 2: python runtime ---
FROM python:3.13-slim
WORKDIR /srv/arrdeck
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY --from=frontend /build/dist/ ./static/
EXPOSE 3500
# python:slim ships no curl; urllib is already there. localhost is trusted by
# is_lan(), so this reaches a real endpoint rather than an unauthenticated stub.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:3500/api/v1/services', timeout=4)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3500"]
