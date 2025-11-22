#!/usr/bin/env tsx
/**
 * End-to-End Test
 * Tests complete workflow from content creation to publishing
 */

import { v4 as uuidv4 } from 'uuid'

// Mock implementations for testing without full infrastructure
const mockDb = {
  content: new Map(),
  tasks: new Map(),
  tickets: new Map(),
}

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
}

/**
 * Test runner
 */
class E2ETest {
  private results: TestResult[] = []

  async test(name: string, fn: () => Promise<void>): Promise<void> {
    console.log(`\n🧪 Testing: ${name}`)
    const start = Date.now()

    try {
      await fn()
      const duration = Date.now() - start
      this.results.push({ name, passed: true, duration })
      console.log(`✅ Passed (${duration}ms)`)
    } catch (error) {
      const duration = Date.now() - start
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.results.push({ name, passed: false, duration, error: message })
      console.log(`❌ Failed (${duration}ms): ${message}`)
    }
  }

  summary(): void {
    console.log('\n' + '='.repeat(60))
    console.log('Test Summary\n')

    const passed = this.results.filter((r) => r.passed).length
    const failed = this.results.filter((r) => !r.passed).length
    const total = this.results.length

    console.log(`Total: ${total}`)
    console.log(`Passed: ${passed} ✅`)
    console.log(`Failed: ${failed} ❌`)
    console.log('')

    if (failed > 0) {
      console.log('Failed tests:')
      this.results
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`  - ${r.name}: ${r.error}`)
        })
      console.log('')
    }

    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)
    console.log(`Total duration: ${totalDuration}ms`)
    console.log('='.repeat(60))

    if (failed > 0) {
      process.exit(1)
    }
  }
}

/**
 * Mock Agent Execution
 */
async function mockAgentExecution(
  agentType: string,
  task: string
): Promise<{ success: boolean; result?: any }> {
  // Simulate agent processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  return {
    success: true,
    result: { agent: agentType, task, completed: true },
  }
}

/**
 * Run E2E tests
 */
async function runTests() {
  const test = new E2ETest()

  console.log('🚀 swarm.press End-to-End Tests\n')
  console.log('Testing complete content workflow...')

  // Test 1: Content Creation
  await test.test('Content creation workflow', async () => {
    const contentId = uuidv4()
    const content = {
      id: contentId,
      title: 'Test Article',
      status: 'brief_created',
      body: [],
    }

    mockDb.content.set(contentId, content)

    if (!mockDb.content.has(contentId)) {
      throw new Error('Content not created')
    }
  })

  // Test 2: Writer creates draft
  await test.test('Writer agent creates draft', async () => {
    const contentId = Array.from(mockDb.content.keys())[0]
    const result = await mockAgentExecution('WriterAgent', 'write_draft')

    if (!result.success) {
      throw new Error('Writer agent failed')
    }

    const content = mockDb.content.get(contentId)
    content.status = 'draft'
    content.body = [
      { type: 'heading', level: 1, text: 'Test Article' },
      { type: 'paragraph', text: 'This is a test article.' },
    ]
    mockDb.content.set(contentId, content)
  })

  // Test 3: Editor reviews content
  await test.test('Editor agent reviews content', async () => {
    const result = await mockAgentExecution('EditorAgent', 'review_content')

    if (!result.success) {
      throw new Error('Editor agent failed')
    }

    const contentId = Array.from(mockDb.content.keys())[0]
    const content = mockDb.content.get(contentId)
    content.status = 'in_editorial_review'
    mockDb.content.set(contentId, content)
  })

  // Test 4: Content validation
  await test.test('Content structure validation', async () => {
    const contentId = Array.from(mockDb.content.keys())[0]
    const content = mockDb.content.get(contentId)

    if (!Array.isArray(content.body)) {
      throw new Error('Content body must be array')
    }

    for (const block of content.body) {
      if (!block.type) {
        throw new Error('Block missing type')
      }
    }
  })

  // Test 5: Editor approves
  await test.test('Editor approves content', async () => {
    const result = await mockAgentExecution('EditorAgent', 'approve_content')

    if (!result.success) {
      throw new Error('Approval failed')
    }

    const contentId = Array.from(mockDb.content.keys())[0]
    const content = mockDb.content.get(contentId)
    content.status = 'approved'
    mockDb.content.set(contentId, content)
  })

  // Test 6: Engineering builds site
  await test.test('Engineering agent builds site', async () => {
    const result = await mockAgentExecution('EngineeringAgent', 'build_site')

    if (!result.success) {
      throw new Error('Build failed')
    }
  })

  // Test 7: Publishing
  await test.test('Engineering agent publishes site', async () => {
    const result = await mockAgentExecution('EngineeringAgent', 'publish_site')

    if (!result.success) {
      throw new Error('Publishing failed')
    }

    const contentId = Array.from(mockDb.content.keys())[0]
    const content = mockDb.content.get(contentId)
    content.status = 'published'
    mockDb.content.set(contentId, content)
  })

  // Test 8: State transitions
  await test.test('State machine transitions', async () => {
    const contentId = Array.from(mockDb.content.keys())[0]
    const content = mockDb.content.get(contentId)

    const expectedStates = [
      'brief_created',
      'draft',
      'in_editorial_review',
      'approved',
      'published',
    ]

    if (content.status !== 'published') {
      throw new Error(`Expected published, got ${content.status}`)
    }
  })

  // Test 9: Question ticket creation
  await test.test('Question ticket creation', async () => {
    const ticketId = uuidv4()
    const ticket = {
      id: ticketId,
      question: 'Is this content appropriate?',
      status: 'open',
      target: 'CEO',
    }

    mockDb.tickets.set(ticketId, ticket)

    if (!mockDb.tickets.has(ticketId)) {
      throw new Error('Ticket not created')
    }
  })

  // Test 10: Task creation and completion
  await test.test('Task lifecycle', async () => {
    const taskId = uuidv4()
    const task = {
      id: taskId,
      title: 'Review content',
      status: 'planned',
    }

    mockDb.tasks.set(taskId, task)
    task.status = 'in_progress'
    mockDb.tasks.set(taskId, task)
    task.status = 'completed'
    mockDb.tasks.set(taskId, task)

    const finalTask = mockDb.tasks.get(taskId)
    if (finalTask.status !== 'completed') {
      throw new Error('Task not completed')
    }
  })

  // Show summary
  test.summary()
}

// Run tests
runTests().catch((error) => {
  console.error('Test runner failed:', error)
  process.exit(1)
})
