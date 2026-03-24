# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MC_SERVER_HOST=0.0.0.0 \
    MC_SERVER_PORT=8000

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist

EXPOSE 8000
WORKDIR /app/backend
CMD ["python", "-m", "app.main", "--host", "0.0.0.0", "--port", "8000"]
