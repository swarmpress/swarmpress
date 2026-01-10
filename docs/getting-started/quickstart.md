# Quickstart

> **Last Updated:** 2026-01-10
> **Status:** Current

Get swarm.press running locally in 5 minutes.

---

## Prerequisites

- Node.js 20+
- pnpm 8+
- Docker and Docker Compose
- Anthropic API key (for Claude agents)

---

## 1. Clone and Install

```bash
git clone <repo-url>
cd swarm-press
pnpm install
```

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set:
```bash
ANTHROPIC_API_KEY=your-api-key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/swarmpress
```

## 3. Start Infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL (port 5432)
- NATS JetStream (port 4222)
- Temporal (port 7233)
- Temporal UI (port 8233)

## 4. Bootstrap Database

```bash
npx tsx scripts/bootstrap.ts
```

This creates:
- Database tables
- Default company, departments, roles
- Initial agents

## 5. Start Development Servers

```bash
pnpm dev
```

Or start services individually:
```bash
# Backend API (port 3000)
pnpm --filter @swarm-press/backend dev

# Admin Dashboard (port 3002)
pnpm --filter @swarm-press/admin dev

# Temporal Worker
pnpm --filter @swarm-press/workflows dev
```

## 6. Access the Application

| Service | URL |
|---------|-----|
| Admin Dashboard | http://localhost:3002 |
| API Server | http://localhost:3000 |
| tRPC Endpoint | http://localhost:3000/api/trpc |
| Temporal UI | http://localhost:8233 |

---

## Next Steps

1. **Explore the Admin Dashboard** - Create content, manage workflows
2. **Read the Architecture** - [Overview](../architecture/overview.md)
3. **Set up GitHub** - [GitHub OAuth Guide](../guides/github-oauth.md)
4. **Deploy to Production** - [Deployment Guide](../guides/deployment.md)

---

## Troubleshooting

### Port already in use
```bash
lsof -ti:3000 | xargs kill -9
```

### Database connection failed
Ensure Docker is running:
```bash
docker compose ps
```

### Temporal not connecting
Check Temporal is healthy:
```bash
docker compose logs temporal
```
