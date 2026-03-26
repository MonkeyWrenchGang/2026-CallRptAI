# Stage 1: Build React frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Verify database integrity at build time
RUN python -c "import sqlite3; conn=sqlite3.connect('backend/data/ncua_callreports.db'); tables=conn.execute('SELECT name FROM sqlite_master WHERE type=\"table\"').fetchall(); print('Tables:', [t[0] for t in tables]); assert any('institutions' in t for t in tables), 'institutions table missing!'; print('DB OK')"

# Copy React build into the location main.py expects
COPY --from=frontend-build /app/frontend/build ./frontend/build

# Data directory (mounted as Render persistent disk in production)
RUN mkdir -p ./data

WORKDIR /app/backend

EXPOSE 8000

CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
