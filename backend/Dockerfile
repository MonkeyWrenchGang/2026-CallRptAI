FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Seed the database at build time so the container starts instantly
ENV DATABASE_PATH=/app/data/callreports.db
RUN python ingest.py

EXPOSE 8000

# Startup: re-seed if DB is missing (e.g. fresh volume mount), then launch
CMD ["sh", "-c", "python -c \"import sqlite3, os; conn=sqlite3.connect(os.environ.get('DATABASE_PATH','/app/data/callreports.db')); c=conn.execute('SELECT COUNT(*) FROM institutions'); print(f'DB has {c.fetchone()[0]} institutions'); conn.close()\" 2>/dev/null || python ingest.py; uvicorn main:app --host 0.0.0.0 --port 8000"]
