# Deployment Guide

> **Last Updated:** 2026-05-12
> **Status:** Aligned with the live cinqueterre.travel deploy

This guide covers two distinct deployments:

1. **The platform** — backend API, Temporal worker, Postgres, NATS,
   admin dashboard. This is what you stand up on AWS / Fly / Kubernetes /
   etc. It runs the agents and orchestration but **does not build or
   serve any site**.
2. **Per-site builds** — each site (e.g. `cinqueterre.travel`) ships
   with its own `.github/workflows/deploy.yml`, which builds the Astro
   theme against the site's `content/` and publishes via
   `actions/deploy-pages`. The platform never runs `astro build`
   locally and never pushes to a `gh-pages` branch.

This separation is a core architectural property: the platform is the
agent organization; the site repo is the deployable artifact. They
communicate via `RepoClient` (Octokit calls into the site repo).

## Overview

The platform requires:
- PostgreSQL database
- NATS JetStream message broker
- Temporal workflow engine
- Node.js application servers (API + Temporal worker — auto-starts the
  `OutboxWorker` and `EventTriggerService` services in `server.ts`)
- A monorepo Personal Access Token stored as `MONOREPO_PAT` in each
  site repo's Actions secrets (see "Per-site GitHub Pages deploy" below)

Each site requires:
- Its own GitHub repo
- A `.github/workflows/deploy.yml` (copy from `cinqueterre.travel`)
- GitHub Pages configured with `build_type=workflow` (not legacy
  `gh-pages` branch source)
- The `MONOREPO_PAT` secret so the workflow can clone the monorepo for
  the Astro theme

## Deployment Options

### Option 1: Fully Managed (Recommended)

Use managed services for all infrastructure:

- **Database**: AWS RDS PostgreSQL, Supabase, or Google Cloud SQL
- **NATS**: NATS Cloud or Synadia Cloud
- **Temporal**: Temporal Cloud
- **API Server**: AWS ECS Fargate, Google Cloud Run, or Fly.io
- **Worker**: Same as API server (separate container)
- **Static Sites**: Netlify, Vercel, or Cloudflare Pages

**Pros**: Minimal operational overhead, high reliability
**Cons**: Higher cost

### Option 2: Kubernetes

Deploy all components to Kubernetes:

- **Database**: PostgreSQL via operator or managed service
- **NATS**: NATS Helm chart with JetStream enabled
- **Temporal**: Temporal Helm chart
- **API + Worker**: Kubernetes deployments
- **Static Sites**: External hosting service

**Pros**: Full control, portable
**Cons**: Complex setup, operational overhead

### Option 3: Docker Compose (Development Only)

Continue using Docker Compose for staging:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

**Not recommended for production** due to single-point-of-failure.

## Per-site GitHub Pages deploy

Every site repo owns its own deploy. The platform's role is to merge
the PR; everything from there is the site's GitHub Actions workflow.

### Required workflow file (`<site-repo>/.github/workflows/deploy.yml`)

Use `cinqueterre.travel/.github/workflows/deploy.yml` as the canonical
template. The shape is:

1. Trigger on `push: branches: [main]` (so a merged PR fires it).
2. Check out the site repo.
3. Check out the swarm-press monorepo (using `MONOREPO_PAT`) so the
   Astro theme is available.
4. `pnpm install` in the monorepo.
5. `astro build` against the site's `content/`.
6. `actions/upload-pages-artifact@v3` on the build output.
7. `actions/deploy-pages@v4` in a separate `deploy` job with the right
   `pages: write` and `id-token: write` permissions.

### One-time setup per site

```bash
# 1) Add the MONOREPO_PAT secret on the site repo
#    (PAT must have `repo` scope to read the swarm-press monorepo;
#     if the monorepo is public, a fine-grained token still works.)
gh secret set MONOREPO_PAT --repo <owner>/<site-repo> --body "$PAT"

# 2) Switch GitHub Pages source to "GitHub Actions"
#    (NOT the legacy gh-pages branch source — that disconnects the
#     workflow from the actual deployment.)
gh api -X POST "/repos/<owner>/<site-repo>/pages" \
  -f build_type=workflow \
  || gh api -X PUT "/repos/<owner>/<site-repo>/pages" \
       -f build_type=workflow
```

### OAuth token vs. workflow scope

If your platform's GitHub OAuth token (the one used by `RepoClient`) is
missing the `workflow` scope, it cannot edit `.github/workflows/*` files
on the site repo. Two options:

- **Recommended:** keep the OAuth token narrow and use a separate PAT
  with `workflow` scope when you need to update the deploy workflow
  itself. Set this PAT as `MONOREPO_PAT` (the same secret the workflow
  already uses) so site maintainers have one credential to rotate.
- Re-issue the OAuth token with `workflow` scope. This widens what every
  agent can do — only do this if you trust the agent layer fully.

### Verifying a site is wired correctly

After merging a PR to a site repo:

1. The push should trigger an Actions run within ~10 seconds.
2. The `build` job should succeed (Astro produces a `dist/`).
3. The `deploy` job should report a deployment URL.
4. `gh api repos/<owner>/<site-repo>/pages` should return
   `"build_type": "workflow"`.
5. Hit the live URL — the new content should be present.

If the workflow runs but the live site doesn't update, check Pages
config: a legacy `gh-pages` branch source silently overrides the
`actions/deploy-pages` artifact.

## Step-by-Step: AWS Deployment

### Prerequisites

- AWS account with appropriate IAM permissions
- AWS CLI configured
- Docker installed locally
- GitHub repository for code

### 1. Deploy PostgreSQL Database

```bash
# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier swarmpress-prod \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --master-username swarmpress \
  --master-user-password <secure-password> \
  --allocated-storage 100 \
  --storage-encrypted \
  --vpc-security-group-ids sg-xxxxx \
  --db-subnet-group-name swarmpress-subnet-group \
  --backup-retention-period 7 \
  --multi-az \
  --publicly-accessible false
```

Wait for instance to be available, then run migrations:

```bash
# Connect via bastion or VPN
export DATABASE_URL="postgresql://swarmpress:<password>@swarmpress-prod.xxxxx.us-east-1.rds.amazonaws.com:5432/swarmpress"

# Run migrations
psql $DATABASE_URL -f packages/backend/migrations/001_initial_schema.sql
psql $DATABASE_URL -f packages/backend/migrations/002_state_audit_log.sql
```

### 2. Set Up NATS Cloud

1. Sign up at https://www.synadia.com/cloud
2. Create NATS cluster
3. Enable JetStream
4. Create credentials file
5. Note connection URL

### 3. Set Up Temporal Cloud

1. Sign up at https://temporal.io/cloud
2. Create namespace
3. Generate certificates
4. Note namespace address

### 4. Build and Push Container Images

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Create repositories
aws ecr create-repository --repository-name swarmpress/backend
aws ecr create-repository --repository-name swarmpress/workflows

# Build images
pnpm build

docker build -f packages/backend/Dockerfile \
  -t <account-id>.dkr.ecr.us-east-1.amazonaws.com/swarmpress/backend:latest .

docker build -f packages/workflows/Dockerfile \
  -t <account-id>.dkr.ecr.us-east-1.amazonaws.com/swarmpress/workflows:latest .

# Push images
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/swarmpress/backend:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/swarmpress/workflows:latest
```

### 5. Deploy to ECS

Create task definitions:

**Backend Task Definition** (`backend-task-def.json`):
```json
{
  "family": "swarmpress-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "backend",
      "image": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/swarmpress/backend:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "API_PORT", "value": "3000" },
        { "name": "LOG_LEVEL", "value": "info" }
      ],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "NATS_URL", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "TEMPORAL_URL", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "API_SECRET", "valueFrom": "arn:aws:secretsmanager:..." }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/swarmpress-backend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

**Workflows Task Definition** (similar structure, different image)

Deploy services:

```bash
# Register task definitions
aws ecs register-task-definition --cli-input-json file://backend-task-def.json
aws ecs register-task-definition --cli-input-json file://workflows-task-def.json

# Create services
aws ecs create-service \
  --cluster swarmpress-prod \
  --service-name backend \
  --task-definition swarmpress-backend \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=backend,containerPort=3000"

aws ecs create-service \
  --cluster swarmpress-prod \
  --service-name workflows \
  --task-definition swarmpress-workflows \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}"
```

### 6. Configure Load Balancer

```bash
# Create Application Load Balancer
aws elbv2 create-load-balancer \
  --name swarmpress-alb \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx

# Create target group
aws elbv2 create-target-group \
  --name swarmpress-backend-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-xxx \
  --health-check-path /health

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:... \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:...
```

### 7. Set Up Domain and SSL

```bash
# Request certificate in ACM
aws acm request-certificate \
  --domain-name api.yourdomain.com \
  --validation-method DNS

# Create Route53 records
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://dns-records.json
```

### 8. Configure GitHub Webhook

1. Go to your GitHub repository
2. Settings → Webhooks → Add webhook
3. Payload URL: `https://api.yourdomain.com/api/webhooks/github`
4. Content type: `application/json`
5. Secret: Your `GITHUB_WEBHOOK_SECRET`
6. Events: Pull requests, Pull request reviews, Issues, Issue comments
7. Active: Yes

### 9. Seed Initial Data

```bash
# Connect to production database via bastion
ssh -L 5432:swarmpress-prod.xxxxx.rds.amazonaws.com:5432 bastion-host

# In another terminal, seed data
tsx scripts/seed.ts
```

### 10. Verify Deployment

```bash
# Check health
curl https://api.yourdomain.com/health

# Check ECS services
aws ecs describe-services --cluster swarmpress-prod --services backend workflows

# Check logs
aws logs tail /ecs/swarmpress-backend --follow
```

## Step-by-Step: Fly.io Deployment

Simpler alternative to AWS:

### 1. Install Fly CLI

```bash
brew install flyctl
fly auth login
```

### 2. Create App

```bash
# In packages/backend
fly launch --name swarmpress-backend --region sea

# In packages/workflows
fly launch --name swarmpress-workflows --region sea
```

### 3. Provision PostgreSQL

```bash
fly postgres create --name swarmpress-db --region sea
fly postgres attach swarmpress-db --app swarmpress-backend
```

### 4. Set Secrets

```bash
fly secrets set \
  ANTHROPIC_API_KEY=<key> \
  NATS_URL=<nats-url> \
  TEMPORAL_URL=<temporal-url> \
  API_SECRET=<secret> \
  GITHUB_TOKEN=<token> \
  --app swarmpress-backend

fly secrets set \
  ANTHROPIC_API_KEY=<key> \
  DATABASE_URL=<db-url> \
  NATS_URL=<nats-url> \
  TEMPORAL_URL=<temporal-url> \
  --app swarmpress-workflows
```

### 5. Deploy

```bash
fly deploy --app swarmpress-backend
fly deploy --app swarmpress-workflows
```

### 6. Scale

```bash
fly scale count 2 --app swarmpress-backend
fly scale count 2 --app swarmpress-workflows
```

### 7. Custom Domain

```bash
fly certs create api.yourdomain.com --app swarmpress-backend
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (EKS, GKE, or AKS)
- kubectl configured
- Helm 3 installed

### 1. Install PostgreSQL

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami

helm install swarmpress-db bitnami/postgresql \
  --set auth.username=swarmpress \
  --set auth.password=<password> \
  --set auth.database=swarmpress \
  --set primary.persistence.size=100Gi \
  --set primary.resources.requests.cpu=1000m \
  --set primary.resources.requests.memory=2Gi
```

### 2. Install NATS

```bash
helm repo add nats https://nats-io.github.io/k8s/helm/charts

helm install swarmpress-nats nats/nats \
  --set nats.jetstream.enabled=true \
  --set nats.jetstream.memStorage.enabled=true \
  --set nats.jetstream.memStorage.size=1Gi \
  --set nats.jetstream.fileStorage.enabled=true \
  --set nats.jetstream.fileStorage.size=10Gi
```

### 3. Install Temporal

```bash
helm repo add temporalio https://go.temporal.io/helm-charts

helm install temporalio temporalio/temporal \
  --set server.replicaCount=1 \
  --set cassandra.config.cluster_size=3 \
  --set prometheus.enabled=false \
  --set grafana.enabled=false \
  --set elasticsearch.enabled=true
```

### 4. Deploy Applications

Create Kubernetes manifests:

**backend-deployment.yaml**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: swarmpress-backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: swarmpress-backend
  template:
    metadata:
      labels:
        app: swarmpress-backend
    spec:
      containers:
      - name: backend
        image: your-registry/swarmpress-backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: swarmpress-secrets
              key: database-url
        - name: NATS_URL
          value: "nats://swarmpress-nats:4222"
        - name: TEMPORAL_URL
          value: "temporalio-frontend:7233"
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
---
apiVersion: v1
kind: Service
metadata:
  name: swarmpress-backend
spec:
  selector:
    app: swarmpress-backend
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

Apply:

```bash
kubectl apply -f backend-deployment.yaml
kubectl apply -f workflows-deployment.yaml
```

## Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `NATS_URL` | NATS server URL | `nats://nats.example.com:4222` |
| `TEMPORAL_URL` | Temporal server address | `temporal.example.com:7233` |
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-...` |
| `API_SECRET` | JWT signing secret | Random 32+ char string |

### GitHub Integration

The platform uses **per-website credentials** stored in the
`websites.github_*` columns (set via the admin "Connect GitHub" flow).
`RepoClient` resolves them per call, so the platform itself does not
need a global `GITHUB_TOKEN` for content I/O.

The env vars below are only relevant for the legacy global-creds path
or for the webhook receiver (which is shared across all sites):

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_WEBHOOK_SECRET` | Webhook secret used for HMAC verification of GitHub deliveries | Always |
| `GITHUB_OAUTH_CLIENT_ID` | OAuth app client id (admin login) | For admin login |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth app secret | For admin login |
| `GITHUB_TOKEN` | Fallback PAT — used only if a website has no per-site creds | Legacy |
| `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` / `GITHUB_INSTALLATION_ID` | GitHub App credentials | If using App auth |

Each site repo additionally needs its own Actions secret
**`MONOREPO_PAT`** (see "Per-site GitHub Pages deploy" above) — that
lives on the site repo, not the platform.

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `API_PORT` | API server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `LOG_LEVEL` | Logging level | `info` |
| `CORS_ORIGIN` | Allowed origins | `*` |
| `CEO_EMAIL` | CEO email | `ceo@swarm.press` |
| `CEO_PASSWORD` | CEO password | Random |

## Security Checklist

Production security requirements:

- [ ] All secrets stored in secret manager (AWS Secrets Manager, etc.)
- [ ] Database uses SSL/TLS connections
- [ ] NATS uses TLS connections
- [ ] API uses HTTPS with valid certificate
- [ ] CORS restricted to specific origins
- [ ] Rate limiting enabled on API
- [ ] PostgreSQL not publicly accessible
- [ ] Strong passwords for all accounts
- [ ] GitHub webhook secret configured
- [ ] Regular security updates applied
- [ ] Audit logging enabled
- [ ] Backup and disaster recovery tested

## Monitoring

### CloudWatch (AWS)

```bash
# Create log groups
aws logs create-log-group --log-group-name /ecs/swarmpress-backend
aws logs create-log-group --log-group-name /ecs/swarmpress-workflows

# Create alarms
aws cloudwatch put-metric-alarm \
  --alarm-name swarmpress-backend-errors \
  --metric-name Errors \
  --namespace AWS/ECS \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold
```

### Datadog

```yaml
# In Kubernetes
apiVersion: v1
kind: ConfigMap
metadata:
  name: datadog-agent
data:
  datadog.yaml: |
    logs_enabled: true
    apm_enabled: true
```

### Custom Metrics

Subscribe to CloudEvents and export metrics:

```typescript
// metrics-exporter.ts
import { eventBus } from './event-bus'
import { Counter, Gauge } from 'prom-client'

const contentStateGauge = new Gauge({
  name: 'swarmpress_content_by_state',
  help: 'Content items by state',
  labelNames: ['state']
})

eventBus.subscribe('swarmpress.content.state_changed', (event) => {
  // Update metrics
  contentStateGauge.inc({ state: event.data.to })
  contentStateGauge.dec({ state: event.data.from })
})
```

## Backup and Recovery

### Database Backups

**AWS RDS**:
```bash
# Automated backups enabled by default
# Manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier swarmpress-prod \
  --db-snapshot-identifier swarmpress-manual-backup-$(date +%Y%m%d)
```

**PostgreSQL**:
```bash
# Backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup-20250115.sql
```

### Disaster Recovery

1. **Database**: Restore from RDS snapshot or pg_dump
2. **NATS**: JetStream data backed up to S3
3. **Temporal**: Database backed up (Cassandra/PostgreSQL)
4. **Application Code**: Deploy from Git tag
5. **Configuration**: Secrets from secret manager

## Performance Tuning

### PostgreSQL

```sql
-- Increase connection pool
ALTER SYSTEM SET max_connections = 200;

-- Tune memory
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET work_mem = '256MB';

-- Enable query planner optimizations
ALTER SYSTEM SET random_page_cost = 1.1;
```

### NATS

```bash
# Increase JetStream memory
nats-server -js -m 8222 --store_dir=/data --max_memory_store=2GB
```

### Application

```typescript
// Increase connection pool
const pool = new Pool({
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})
```

## Troubleshooting

### High CPU Usage

```bash
# Check ECS tasks
aws ecs describe-tasks --cluster swarmpress-prod --tasks <task-arn>

# Check CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=backend \
  --start-time 2025-01-15T00:00:00Z \
  --end-time 2025-01-15T23:59:59Z \
  --period 3600 \
  --statistics Average
```

### Database Connection Pool Exhausted

```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
AND state_change < now() - interval '5 minutes';
```

### Temporal Workflow Stuck

```bash
# Check Temporal UI
open https://cloud.temporal.io

# Terminate workflow
temporal workflow terminate \
  --workflow-id <workflow-id> \
  --reason "Manual intervention"
```

## Cost Optimization

### AWS Cost Reduction

- Use Reserved Instances for RDS
- Use Fargate Spot for non-critical workers
- Enable S3 lifecycle policies for old data
- Use CloudFront for static assets
- Shut down dev/staging during off-hours

### Right-Sizing

- Monitor CPU/memory usage over 30 days
- Downsize over-provisioned instances
- Use auto-scaling based on metrics

## Upgrade Strategy

1. **Test in staging**: Deploy to staging environment first
2. **Database migrations**: Run migrations with backward compatibility
3. **Blue-Green deployment**: Deploy new version alongside old
4. **Gradual rollout**: Route 10% → 50% → 100% traffic
5. **Rollback plan**: Keep old version ready for quick rollback

## Support

For deployment issues:
- Check CloudWatch/ECS logs
- Review Temporal workflow history
- Monitor NATS JetStream status
- Verify GitHub webhook deliveries
- Contact infrastructure team
