#!/bin/bash
# ── CallRpt AI — Startup Script ────────────────────────────────────────
# Starts both the FastAPI backend and React frontend dev server.

set -e

echo "📊 CallRpt AI — Executive Intelligence for Community Banking"
echo "============================================================"
echo ""

# ── Check for .env ──────────────────────────────────────────────────────
if [ -f backend/.env ]; then
    export $(grep -v '^#' backend/.env | xargs)
    echo "✓ Loaded .env"
fi

# Set defaults
export DATABASE_PATH="${DATABASE_PATH:-./backend/data/callreports.db}"

# ── Initialize database if needed ───────────────────────────────────────
if [ ! -f "$DATABASE_PATH" ]; then
    echo "⏳ Initializing database and seeding sample data..."
    cd backend && python ingest.py && cd ..
else
    echo "✓ Database found"
fi

# ── Start backend ───────────────────────────────────────────────────────
echo ""
echo "🚀 Starting FastAPI backend on http://localhost:8000 ..."
cd backend
python -m uvicorn main:app --host :: --port 8000 --reload &
BACKEND_PID=$!
cd ..

# ── Start frontend ──────────────────────────────────────────────────────
echo "🚀 Starting React frontend on http://localhost:3000 ..."
cd frontend
npm start &
FRONTEND_PID=$!
cd ..

echo ""
echo "============================================================"
echo "📊 CallRpt AI is running!"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠  No ANTHROPIC_API_KEY set — running in demo mode."
    echo "   Add your key to backend/.env for full Claude AI analysis."
fi
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait for either process
wait $BACKEND_PID $FRONTEND_PID
