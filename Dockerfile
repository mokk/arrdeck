# --- Stage 1: frontend build ---
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# --- Stage 2: python runtime ---
FROM python:3.12-slim
WORKDIR /srv/arrdeck
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY --from=frontend /build/dist/ ./static/
EXPOSE 3500
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3500"]
