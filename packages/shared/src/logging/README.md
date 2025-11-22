# Logging and Error Tracking

Structured logging system with correlation IDs for tracing requests across the agent.press platform.

## Features

- **Structured JSON logging** - All logs in parsable JSON format
- **Correlation IDs** - Track requests across services and workflows
- **Error tracking** - Capture and report errors with full context
- **Async context** - Automatic correlation ID propagation
- **Express middleware** - Easy integration with API server
- **CloudEvents integration** - Include correlation data in events

## Usage

### Basic Logging

```typescript
import { logger } from '@agent-press/shared/logging'

// Info log
logger.info('Content created', { contentId: 'abc-123' })

// Error log
logger.error('Failed to create content', error, { contentId: 'abc-123' })

// Debug log (only shown if LOG_LEVEL=debug)
logger.debug('Fetching from database', { query: 'SELECT * FROM content' })
```

### Child Loggers

Create child loggers with fixed context:

```typescript
import { logger } from '@agent-press/shared/logging'

// Create logger for specific agent
const agentLogger = logger.child({ agentId: 'writer-001' })

agentLogger.info('Starting task')  // Automatically includes agentId
agentLogger.info('Task completed') // Automatically includes agentId
```

### Correlation IDs

Track requests across services:

```typescript
import { runWithCorrelation, getCorrelationId } from '@agent-press/shared/logging'

// Run function with correlation context
runWithCorrelation('corr-123', () => {
  logger.info('Processing request') // Includes correlationId

  // Get current correlation ID
  const id = getCorrelationId()
  console.log(id) // 'corr-123'
})
```

### Express Middleware

Add correlation IDs to all requests:

```typescript
import express from 'express'
import { correlationMiddleware } from '@agent-press/shared/logging'

const app = express()

// Add correlation middleware
app.use(correlationMiddleware())

app.get('/api/content', (req, res) => {
  // Correlation ID automatically available
  logger.info('Fetching content')
  res.json({ data: [] })
})
```

The middleware:
- Reads `X-Correlation-ID` header or generates new ID
- Sets `X-Correlation-ID` response header
- Makes correlation ID available via `getCorrelationId()`

### Error Tracking

Track errors with full context:

```typescript
import { errorTracker } from '@agent-press/shared/logging'

try {
  await doSomething()
} catch (error) {
  await errorTracker.track(error, {
    context: { contentId: 'abc-123' },
    severity: 'high'
  })
}
```

Wrap functions for automatic error tracking:

```typescript
import { withErrorTracking } from '@agent-press/shared/logging'

const safeFunction = withErrorTracking(async () => {
  // Your code here
  // Errors automatically tracked
}, {
  context: { operation: 'content-creation' }
})

await safeFunction()
```

### Error Middleware

Add error tracking to Express:

```typescript
import { errorMiddleware } from '@agent-press/shared/logging'

app.use(errorMiddleware())

// All unhandled errors will be:
// 1. Logged with full context
// 2. Tracked in error tracker
// 3. Returned as 500 with error ID
```

### CloudEvents Integration

Include correlation data in events:

```typescript
import { getCloudEventsExtension } from '@agent-press/shared/logging'
import { eventBus } from '@agent-press/event-bus'

await eventBus.publish({
  type: 'content.created',
  source: 'agent-press/api',
  data: { contentId: 'abc-123' },
  // Add correlation extension
  ...getCloudEventsExtension()
})
```

## Log Output Format

All logs are JSON:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Content created",
  "context": {
    "correlationId": "corr-123",
    "contentId": "abc-123",
    "agentId": "writer-001"
  }
}
```

Error logs include error details:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "error",
  "message": "Failed to create content",
  "context": {
    "correlationId": "corr-123",
    "contentId": "abc-123"
  },
  "error": {
    "name": "ValidationError",
    "message": "Title is required",
    "stack": "Error: Title is required\n    at ..."
  }
}
```

## Log Levels

- `debug` - Detailed diagnostic information
- `info` - General informational messages
- `warn` - Warning messages for potentially harmful situations
- `error` - Error messages for failures

Set log level via environment variable:

```bash
LOG_LEVEL=debug  # Show all logs
LOG_LEVEL=info   # Default
LOG_LEVEL=warn   # Only warnings and errors
LOG_LEVEL=error  # Only errors
```

## Error Severity Levels

Errors are automatically classified by severity:

- `critical` - Database failures, service outages
- `high` - Unexpected errors, failed operations
- `medium` - API errors, external service failures
- `low` - Validation errors, expected failures

Override automatic classification:

```typescript
await errorTracker.track(error, {
  severity: 'critical'
})
```

## Querying Errors

Get recent errors:

```typescript
import { errorTracker } from '@agent-press/shared/logging'

// Get last 100 errors
const errors = errorTracker.getRecentErrors(100)

// Get critical errors
const critical = errorTracker.getErrorsBySeverity('critical')

// Get errors for specific request
const requestErrors = errorTracker.getErrorsByCorrelation('corr-123')
```

## Custom Error Handlers

Register global error handlers:

```typescript
import { errorTracker } from '@agent-press/shared/logging'

// Send to external service (e.g., Sentry)
errorTracker.registerHandler(async (report) => {
  if (report.severity === 'critical') {
    await sendToSlack(report)
  }
})
```

## Integration Examples

### Temporal Workflows

```typescript
import { logger, runWithCorrelation } from '@agent-press/shared/logging'

export async function contentProductionWorkflow(input: WorkflowInput) {
  const workflowLogger = logger.child({
    workflowId: 'content-production',
    contentId: input.contentId
  })

  workflowLogger.info('Workflow started')

  try {
    await invokeWriterAgent(input)
    workflowLogger.info('Writer agent completed')
  } catch (error) {
    workflowLogger.error('Workflow failed', error)
    throw error
  }
}
```

### Agents

```typescript
import { createLogger } from '@agent-press/shared/logging'

export class WriterAgent {
  private logger = createLogger('info', { agentId: 'writer-001' })

  async execute(task: Task) {
    this.logger.info('Executing task', { taskId: task.id })

    try {
      const result = await this.writeContent(task)
      this.logger.info('Task completed', { taskId: task.id })
      return result
    } catch (error) {
      this.logger.error('Task failed', error, { taskId: task.id })
      throw error
    }
  }
}
```

### API Endpoints

```typescript
import { logger, getCorrelationId } from '@agent-press/shared/logging'

export const contentRouter = router({
  create: publicProcedure
    .input(z.object({ title: z.string() }))
    .mutation(async ({ input }) => {
      const correlationId = getCorrelationId()

      logger.info('Creating content', {
        title: input.title,
        correlationId
      })

      try {
        const content = await contentRepository.create(input)

        logger.info('Content created', {
          contentId: content.id,
          correlationId
        })

        return content
      } catch (error) {
        logger.error('Content creation failed', error, {
          title: input.title,
          correlationId
        })
        throw error
      }
    })
})
```

## Production Setup

### CloudWatch (AWS)

Parse JSON logs in CloudWatch Insights:

```
fields @timestamp, level, message, context.contentId, error.message
| filter level = "error"
| sort @timestamp desc
| limit 100
```

### Datadog

Forward logs with correlation IDs:

```typescript
import { errorTracker } from '@agent-press/shared/logging'

errorTracker.registerHandler(async (report) => {
  // Send to Datadog
  await datadogClient.log({
    level: report.severity,
    message: report.error.message,
    correlation_id: report.correlationId,
    ...report.context
  })
})
```

### Sentry

Integrate with Sentry:

```typescript
import * as Sentry from '@sentry/node'
import { errorTracker } from '@agent-press/shared/logging'

errorTracker.registerHandler(async (report) => {
  if (report.severity === 'critical' || report.severity === 'high') {
    Sentry.captureException(report.error, {
      tags: {
        correlationId: report.correlationId,
        severity: report.severity
      },
      contexts: {
        agentpress: report.context
      }
    })
  }
})
```

## Best Practices

1. **Always use correlation IDs** - Add to all API requests and workflows
2. **Include context** - Add relevant IDs (contentId, taskId, etc.)
3. **Use appropriate log levels** - Don't over-use error/warn
4. **Log business events** - Content created, workflow completed, etc.
5. **Log errors with context** - Include what was being attempted
6. **Use child loggers** - Avoid repeating context
7. **Track errors** - Use errorTracker for all exceptions
8. **Monitor critical errors** - Alert on critical severity

## Performance Considerations

- JSON serialization is fast but not free
- Avoid logging in tight loops
- Use debug level for verbose logs
- Consider sampling for high-volume endpoints
- Log async (already done automatically)

## Testing

Mock logger in tests:

```typescript
import { createLogger } from '@agent-press/shared/logging'

const mockLogger = createLogger('error', { test: true })

// Only errors will be logged during tests
```
