# CallRpt AI — Executive Intelligence for Community Banking

An AI-powered chatbot that analyzes FFIEC (bank) and NCUA (credit union) call report data, delivering executive-level insights through natural conversation.

## Quick Start (Docker)

The fastest way to run the app:

```bash
# 1. Clone the repo and cd into it
cd 2026_CallRptAI

# 2. (Optional) Add your Claude API key for AI-powered analysis
#    Edit .env and set ANTHROPIC_API_KEY=sk-ant-...
#    Get a key at: https://console.anthropic.com/settings/keys

# 3. Build and start
docker compose up --build

# 4. Open http://localhost:3000
```

That's it. The database auto-seeds with sample data on first run.

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

To stop: `docker compose down` (data persists in a Docker volume).

### Claude API Key

Get your key from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). You'll need an Anthropic account. The app works in **demo mode** without it (template-based responses with real data), but adding the key unlocks full natural language analysis, trend interpretation, and strategic recommendations.

Set it in the `.env` file at the project root:

```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

## Quick Start (Without Docker)

### 1. Backend Setup

```bash
cd backend
pip install -r requirements.txt

# Seed the database with sample data
python ingest.py

# Start the API server
uvicorn main:app --reload --port 8000
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm start
# Opens http://localhost:3000
```

### 3. Enable Claude AI (Optional)

Create `backend/.env`:

```
ANTHROPIC_API_KEY=your-key-here
DATABASE_PATH=./data/callreports.db
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React Frontend                  │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐ │
│  │  Chat UI  │  │Institution│  │ Data Tables  │ │
│  │           │  │  Selector │  │             │ │
│  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘ │
└────────┼──────────────┼───────────────┼─────────┘
         │              │               │
         ▼              ▼               ▼
┌─────────────────────────────────────────────────┐
│               FastAPI Backend                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ /api/chat│  │/api/inst │  │ /api/peers   │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │          │
│  ┌────▼──────────────▼───────────────▼───────┐  │
│  │           Query Engine                     │  │
│  │  1. NL → SQL (Claude)                     │  │
│  │  2. Execute SQL (read-only)               │  │
│  │  3. Interpret results (Claude)            │  │
│  └────────────────┬──────────────────────────┘  │
│                   │                              │
│  ┌────────────────▼──────────────────────────┐  │
│  │         SQLite Database                    │  │
│  │  ┌──────────┐  ┌──────────────────────┐   │  │
│  │  │  Instit. │  │  Financial Data       │   │  │
│  │  │  (100)   │  │  (800 qtly records)   │   │  │
│  │  └──────────┘  └──────────────────────┘   │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         ▲                        ▲
         │                        │
    FFIEC CDR                 NCUA 5300
   (Bank Data)            (Credit Union Data)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check, shows if Claude AI is active |
| `/api/chat` | POST | Main chat — send a question, get executive analysis |
| `/api/institutions/search` | POST | Search institutions by name, type, state |
| `/api/institutions/{id}` | GET | Get institution detail with 8 quarters of data |
| `/api/institutions/{id}/peers` | GET | Get peer comparison for an institution |
| `/docs` | GET | Interactive API documentation (Swagger) |

## Data Sources

- **FFIEC Call Reports**: Quarterly filings from ~5,000 FDIC-insured banks via [cdr.ffiec.gov](https://cdr.ffiec.gov/public/)
- **NCUA 5300 Reports**: Quarterly filings from ~4,900 federally insured credit unions via [ncua.gov](https://ncua.gov/analysis/credit-union-corporate-call-report-data)

The prototype ships with **realistic synthetic data** (100 institutions × 8 quarters). The `ingest.py` module has stubs for connecting to the real FFIEC and NCUA bulk download APIs.

## What Users Can Ask

- **Profitability**: "What's our ROA trend?" / "Who are the most profitable banks?"
- **Asset Quality**: "Show NPL ratios across the portfolio" / "Any credit quality red flags?"
- **Capital**: "Are we well-capitalized?" / "Tier 1 capital comparison across peers"
- **Lending**: "Break down our loan portfolio" / "What's the loan-to-deposit ratio trend?"
- **Efficiency**: "Who has the best efficiency ratio?" / "How do our operating costs compare?"
- **Peers**: "How do we stack up against similar-sized banks in Texas?"
- **Trends**: "Show me 2-year asset growth" / "Is our NIM compressing?"

## Production Roadmap

1. **Real Data Ingestion**: Connect to FFIEC CDR and NCUA bulk download APIs
2. **User Authentication**: Bank-specific login, role-based access
3. **Scheduled Updates**: Auto-ingest new quarterly filings
4. **PostgreSQL**: Migrate from SQLite for production scale
5. **Caching**: Redis layer for frequent queries
6. **Export**: PDF reports, Excel downloads
7. **Alerts**: Threshold-based notifications (e.g., NPL > 2%)
8. **Multi-tenancy**: White-label for different institutions
