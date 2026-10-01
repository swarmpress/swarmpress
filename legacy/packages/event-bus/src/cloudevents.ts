import { z } from 'zod'

/**
 * CloudEvents v1.0 specification
 * https://github.com/cloudevents/spec/blob/v1.0/spec.md
 */

export const CloudEventSchema = z.object({
  // Required attributes
  specversion: z.literal('1.0'),
  type: z.string().min(1),
  source: z.string().min(1),
  id: z.string().min(1),

  // Optional attributes
  time: z.string().datetime().optional(),
  datacontenttype: z.string().optional(),
  dataschema: z.string().url().optional(),
  subject: z.string().optional(),

  // Data payload
  data: z.unknown().optional(),
})

export type CloudEvent<T = unknown> = z.infer<typeof CloudEventSchema> & {
  data?: T
}

/**
 * Create a CloudEvent
 */
export function createCloudEvent<T = unknown>(params: {
  type: string
  source: string
  subject?: string
  data?: T
}): CloudEvent<T> {
  return {
    specversion: '1.0',
    type: params.type,
    source: params.source,
    id: generateEventId(),
    time: new Date().toISOString(),
    subject: params.subject,
    datacontenttype: 'application/json',
    data: params.data,
  }
}

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Validate a CloudEvent
 */
export function validateCloudEvent(event: unknown): CloudEvent {
  return CloudEventSchema.parse(event)
}
