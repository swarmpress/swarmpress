import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  StorageType,
  RetentionPolicy,
} from 'nats'
import { getEnv } from '@swarm-press/shared'

/**
 * NATS connection manager
 */
class EventBus {
  private static instance: EventBus
  private connection: NatsConnection | null = null
  private jetstream: JetStreamClient | null = null
  private jsm: JetStreamManager | null = null

  private constructor() {}

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus()
    }
    return EventBus.instance
  }

  /**
   * Connect to NATS
   */
  async connect(): Promise<void> {
    if (this.connection) {
      console.log('NATS already connected')
      return
    }

    try {
      const env = getEnv()
      this.connection = await connect({
        servers: env.NATS_URL,
        name: 'swarmpress-eventbus',
      })

      console.log(`✅ Connected to NATS at ${env.NATS_URL}`)

      // Setup JetStream
      this.jetstream = this.connection.jetstream()
      this.jsm = await this.connection.jetstreamManager()

      // Setup streams
      await this.setupStreams()

      // Handle connection events
      this.connection.closed().then((err) => {
        if (err) {
          console.error('NATS connection closed with error:', err)
        } else {
          console.log('NATS connection closed')
        }
      })
    } catch (error) {
      console.error('Failed to connect to NATS:', error)
      throw error
    }
  }

  /**
   * Setup JetStream streams
   */
  private async setupStreams(): Promise<void> {
    if (!this.jsm) {
      throw new Error('JetStream manager not initialized')
    }

    try {
      // Create swarmpress stream if it doesn't exist
      await this.jsm.streams.add({
        name: 'AGENTPRESS',
        subjects: ['swarmpress.>'],
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        max_age: 7 * 24 * 60 * 60 * 1000000000, // 7 days in nanoseconds
        max_msgs: 1000000,
      })

      console.log('✅ JetStream stream configured')
    } catch (error: any) {
      // Stream might already exist
      if (error.code !== '10058') {
        console.error('Failed to setup JetStream stream:', error)
      }
    }
  }

  /**
   * Get the NATS connection
   */
  getConnection(): NatsConnection {
    if (!this.connection) {
      throw new Error('NATS not connected. Call connect() first.')
    }
    return this.connection
  }

  /**
   * Get JetStream client
   */
  getJetStream(): JetStreamClient {
    if (!this.jetstream) {
      throw new Error('JetStream not initialized. Call connect() first.')
    }
    return this.jetstream
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.drain()
      await this.connection.close()
      this.connection = null
      this.jetstream = null
      this.jsm = null
      console.log('NATS connection closed')
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed()
  }
}

export const eventBus = EventBus.getInstance()
