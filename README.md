# Technology Incident Analysis and AI Assistance System

Web platform to manage support incidents, analyze historical data and suggest solutions using semantic search and RAG.
Original assignment (Spanish): [proyecto_incidentes_ia.md](proyecto_incidentes_ia.md).

## Architecture

```
Frontend (nginx) ──/api──► Spring Boot ──► PostgreSQL
                                │
                                └──► n8n ──► Qdrant
                                        └──► OpenRouter
```

The frontend only consumes Spring Boot. n8n, Qdrant and OpenRouter are never called from the browser.

Detailed diagrams:
- [Architecture, RAG query and indexing sequences](docs/diagrams/architecture.md)
- [Entity-relationship diagram](docs/diagrams/er-diagram.md)

## Features

| View | Requirements | What it does |
|---|---|---|
| **Incidentes** | RF01 | Register incidents. Filter them by category, priority, status and date range. Change their status; resolving an incident records `resolved_at`. Categories and users are managed through the API. |
| **Base de conocimiento** | RF02, RF03 | Create and edit technical articles (problem, symptoms, cause, solution), mark them as verified, and activate or deactivate them. Every change is synced with Qdrant after the transaction commits. Only active and verified articles are used as AI sources. |
| **Asistente IA** | RF04, RF05 | Describe an incident and get a solution with steps, built only from knowledge articles, with each source and its similarity. If nothing is similar enough, it says so instead of making up an answer. |
| **Dashboard** | RF06, RF07 | Indicators (total, resolved, resolution rate, average resolution time, top category) and charts (weekly trend, by category, resolution time per category, by priority). Everything can be filtered by dates, category and priority, and every value comes from the SQL queries in `database/analytics/`. |
| **Historial** | RF08 | Every AI query of an incident with its status, answer, sources and similarities. Each answer can be rated once, from 1 to 5, with an optional comment. |

AI queries go through four statuses: **Pendiente** (`PENDING`), **Respondida** (`ANSWERED`), **Sin resultados** (`NO_RESULTS`) and **Error** (`ERROR`).

## API

Base URL: `http://localhost:8080/api`, or `http://localhost:8081/api` through nginx. Every endpoint is documented in Swagger (`/swagger-ui.html`) and covered by the [Postman collection](docs/postman/README.md).

| Resource | Endpoints |
|---|---|
| Categories | `GET/POST /categories`, `GET/PUT/DELETE /categories/{id}` |
| Users | `GET/POST /users`, `GET/PUT/DELETE /users/{id}` |
| Incidents | `GET /incidents?categoryId&priority&status&from&to`, `POST /incidents`, `GET /incidents/{id}`, `PATCH /incidents/{id}/status` |
| Knowledge base | `GET/POST /knowledge-articles`, `GET/PUT /knowledge-articles/{id}`, `PATCH /knowledge-articles/{id}/activate`, `PATCH /knowledge-articles/{id}/deactivate`, `POST /knowledge-articles/reindex` |
| AI assistant | `POST /incidents/{incidentId}/assistance` |
| History and rating | `GET /incidents/{incidentId}/queries`, `POST /responses/{responseId}/rating` |
| Analytics | `GET /analytics/summary`, `/analytics/by-category`, `/analytics/resolution-time`, `/analytics/weekly-trend`, `/analytics/monthly`, `/analytics/by-priority`. All accept the optional filters `from`, `to`, `categoryId` and `priority`. |
| System | `GET /info` (status and active RAG configuration) |

Errors share one JSON shape (`status`, `error`, `message`, `path`, `fields`) with messages in Spanish:
- **400:** validation failed; `fields` maps each field to its error.
- **404:** the resource does not exist.
- **409:** a business rule conflict, such as a duplicate name or email, deleting a category or user that still has incidents, or rating an answer twice.

## Business rules

- **Spring Boot is the only entry point.** The browser never calls n8n, Qdrant or OpenRouter, and n8n webhooks require a shared secret (`X-Webhook-Secret`).
- **Answers come only from valid sources.**
  - n8n keeps only the articles at or above the similarity threshold (0.60). If none passes, it returns `NO_RESULTS` without calling the language model.
  - Spring Boot then checks again that every source exists and is active in PostgreSQL.
- **An empty description never runs the AI flow.** It is rejected with 400 before any query is stored.
- **AI failures do not break the request.** The query is stored as `ERROR`, with the step that failed.
- **Data integrity:**
  - Category names and user emails are unique.
  - Categories and users that have incidents cannot be deleted.
  - Articles are deactivated, never deleted, so old answers keep their sources.
  - One rating per answer.
- **Keys and credentials** live only in `.env` (see [`.env.example`](.env.example)).

## Structure

```
├── backend/            Spring Boot 4 (Java 21): REST API, JPA, validation
├── frontend/           HTML, CSS and JS (served by nginx)
├── nginx/              /api → backend proxy
├── database/
│   ├── init/           Schema and initial data (run when the volume is created)
│   └── analytics/      SQL queries for the indicators
├── n8n/workflows/      Workflows exported as JSON
├── scripts/            Synthetic data generator
├── docs/               Diagrams, testing, data analysis report, Postman/Swagger evidence
├── docker-compose.yml
└── .env.example
```

## Getting started

**Requirements:** Docker Desktop (or Docker Engine with Compose v2), Git Bash or another POSIX shell to run the scripts, and an [OpenRouter](https://openrouter.ai) API key.

### 1. Configure the environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | What to set |
|---|---|
| `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `N8N_WEBHOOK_SECRET` | Random values (`openssl rand -hex 32`) |
| `OPENROUTER_API_KEY` | Your OpenRouter key. Only n8n uses it, and it is never written into the workflows. |
| `OPENROUTER_EMBEDDING_MODEL`, `OPENROUTER_CHAT_MODEL` | Leave the defaults (`baai/bge-m3` and `anthropic/claude-haiku-5.5`). The reasons are in [chat model selection](docs/chat-model-selection.md). |
| `RAG_SIMILARITY_THRESHOLD`, `RAG_TOP_K` | `0.60` and `5`, chosen in the [threshold calibration](docs/threshold-calibration.md) |
| `*_PORT` | Change only if a port is already taken on your machine (for example `QDRANT_PORT=6343`, `N8N_PORT=5679`) |

`.env` is git-ignored: never commit real keys.

### 2. Start the stack

```bash
docker compose up -d --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:8081 |
| API / Swagger | http://localhost:8080/swagger-ui.html |
| n8n | http://localhost:5678 |
| Qdrant (dashboard) | http://localhost:6333/dashboard |

PostgreSQL runs `database/init/01_schema.sql` and `02_seed.sql` when its volume is created. The seed loads 5 categories, 10 users, 150 incidents (2026-08-10 to 2026-11-01) and the 25 knowledge articles.

`02_seed.sql` is generated with a fixed seed by `python3 scripts/generate_seed.py`. Its rules are in [synthetic data](docs/data-analysis-report/synthetic-data.md).

### 3. Prepare the AI services (first run only)

```bash
# Qdrant collection (1024 dimensions for baai/bge-m3). Idempotent.
./scripts/qdrant/create_collection.sh

# Import and publish the n8n workflows, then restart n8n so the webhooks are registered
docker compose exec n8n n8n import:workflow --separate --input=/workflows
docker compose exec n8n n8n publish:workflow --id=IdxArticlesFlow1
docker compose exec n8n n8n publish:workflow --id=RagAssistFlow2
docker compose restart n8n   # "up -d" would not restart it: nothing changed in its configuration

# Index every knowledge article in Qdrant (active and verified ones are upserted, the rest removed)
curl -X POST http://localhost:8080/api/knowledge-articles/reindex
```

In Git Bash, prefix the `docker compose exec` commands with `MSYS_NO_PATHCONV=1`, or `/workflows` is turned into a Windows path.

After this, creating, editing or deactivating an article from the UI keeps Qdrant in sync on its own. More details on the workflows: [n8n/README.md](n8n/README.md).

### 4. Check it

- **Frontend:** open http://localhost:8081. The badge in the top bar shows `API OK` and the active threshold.
- **API:** run the [Postman collection](docs/postman/README.md) with `npx newman run docs/postman/incidents-rag.postman_collection.json --timeout-request 90000`. Every request should pass.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The UI shows 502 after rebuilding the backend | nginx keeps the old backend IP. Run `docker compose restart frontend`. |
| The assistant or the indexing answer 404, or the query ends as `ERROR` | The workflows are not published, or n8n is still registering its webhooks (it takes a few seconds after it starts). Publish them as in step 3. |
| The query ends as `ERROR` with `401` in the message | `OPENROUTER_API_KEY` is wrong. Fix it in `.env` and run `docker compose up -d n8n`. |
| The assistant always answers `NO_RESULTS` | The articles are not indexed. Run the reindex from step 3. |
| `port is already allocated` | Another program uses that port. Change the matching `*_PORT` in `.env`. |
| Changes in `database/init` have no effect | The scripts only run when the volume is empty. Recreate only the PostgreSQL volume (this deletes the database data): `docker compose stop backend postgres && docker compose rm -f postgres && docker volume rm <project>_postgres_data && docker compose up -d` (check the name with `docker volume ls`), then run the reindex from step 3. Avoid `docker compose down -v`: it also deletes the n8n and Qdrant volumes, so the first-run steps would have to be repeated. |

## Testing

**Unit tests (backend):**

```bash
cd backend && mvn test        # needs Maven 3.9+ and Java 21

# or without installing anything, with the same image the Dockerfile builds with:
docker run --rm -v "$PWD/backend":/app -w /app maven:3.9-eclipse-temurin-21 mvn -q test
```

**Mandatory functional tests:**

| # | Test | Evidence |
|---:|---|---|
| 1 | Connectivity incident gets relevant solutions through RAG | [AI tests](docs/testing/ai-tests.md) |
| 2 | Application runtime error retrieves the right articles | [AI tests](docs/testing/ai-tests.md) |
| 3 | Not enough information: the model does not make up a solution | [AI tests](docs/testing/ai-tests.md) |
| 4 | Incidents of a category match the relational database | [Analytics tests](docs/testing/analytics-tests.md) |
| 5 | Weekly trend matches the SQL queries | [Analytics tests](docs/testing/analytics-tests.md) |
| 6 | A deactivated article is no longer used as a source | [AI tests](docs/testing/ai-tests.md) |
| 7 | A blank description does not run the AI flow | [AI tests](docs/testing/ai-tests.md) |
| 8 | Embedding service failure is handled | [AI tests](docs/testing/ai-tests.md) |
| 9 | History of the AI assistance of an incident | [History and rating tests](docs/testing/history-rating-tests.md) |
| 10 | Rating an answer is stored | [History and rating tests](docs/testing/history-rating-tests.md) |

Ways to repeat them:
- **AI tests:** `python3 -I scripts/testing/run_ai_tests.py` runs tests 1, 2, 3, 6, 7 and 8 through the API.
- **Postman collection:** covers tests 1, 3, 6, 7, 9 and 10.

## Deliverables

| Deliverable | Where |
|---|---|
| Frontend | [`frontend/`](frontend/) |
| Spring Boot backend | [`backend/`](backend/) |
| SQL script with initial data | [`database/init/`](database/init/) (schema and seed) |
| ER and architecture diagrams | [`docs/diagrams/`](docs/diagrams/) |
| n8n workflows (JSON) | [`n8n/workflows/`](n8n/workflows/) |
| Docker Compose | [`docker-compose.yml`](docker-compose.yml) |
| `.env.example` | [`.env.example`](.env.example) |
| Swagger and Postman evidence | [`docs/postman/`](docs/postman/README.md) |
| Testing document | [`docs/testing/`](docs/testing/) |
| Data analysis report | [`docs/data-analysis-report/`](docs/data-analysis-report/README.md): indicators, SQL used, interpretation and conclusions |
| RAG decisions | [Threshold calibration](docs/threshold-calibration.md), [chat model selection](docs/chat-model-selection.md), [knowledge topics](docs/knowledge-topics.md) |
| AI usage | [`AI_USAGE.md`](AI_USAGE.md) |

## Conventions

- **Language:** code, comments, commits, PRs and documentation in English. User-visible frontend text (labels, buttons, messages) and user-facing data (incidents, knowledge articles, AI answers) in Spanish.
- **Branches:** `main` holds releases, `develop` is for integration. Use `feature/<module>` and `fix/<description>` branched from `develop`, merged through Pull Requests.
- **Commits:** small, with a conventional prefix, e.g. `feat(incidents): add priority filter`.

## Team

Tasks, phases and integration points: [docs/WORK_PLAN.md](docs/WORK_PLAN.md).

| Member | Module |
|---|---|
| Jonatan-17 | A: Data & analytics (RF06, RF07, data model) |
| Nic-tolb | B: Management & operations (RF01, RF02, RF08) |
| Mic022 | C: AI & RAG (RF03, RF04, RF05) |

## Indicador de confianza

1. ✨ feat(assistance): calcula el indicador de confianza (0 a 100) en el backend.
2. ✅ test(assistance): pruebas del indicador.
3. 💄 feat(frontend): muestra el indicador en el asistente.
