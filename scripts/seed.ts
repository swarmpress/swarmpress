#!/usr/bin/env tsx
/**
 * Seed Script
 * Populates database with initial data for development/testing
 */

import { v4 as uuidv4 } from 'uuid'
import { db } from '../packages/backend/src/db/connection'
import { eventBus } from '../packages/backend/src/event-bus/connection'

/**
 * Create sample website
 */
async function createWebsite() {
  const websiteId = uuidv4()

  await db.query(
    `INSERT INTO websites (id, name, domain, description, config)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      websiteId,
      'TechBlog',
      'techblog.example.com',
      'A blog about technology and innovation',
      JSON.stringify({
        theme: 'modern',
        analytics: true,
      }),
    ]
  )

  console.log(`✅ Created website: ${websiteId}`)
  return websiteId
}

/**
 * Create sample agents
 */
async function createAgents() {
  const agents = [
    {
      id: 'writer-001',
      name: 'Alice',
      role: 'Writer',
      department: 'Content',
      capabilities: ['writing', 'research', 'drafting'],
      status: 'active',
      config: { preferred_topics: ['technology', 'AI', 'software'] },
    },
    {
      id: 'editor-001',
      name: 'Bob',
      role: 'Editor',
      department: 'Editorial',
      capabilities: ['reviewing', 'editing', 'quality_assurance'],
      status: 'active',
      config: { quality_threshold: 7 },
    },
    {
      id: 'engineering-001',
      name: 'Charlie',
      role: 'Engineering',
      department: 'Engineering',
      capabilities: ['building', 'deploying', 'validation'],
      status: 'active',
      config: { build_tool: 'astro' },
    },
    {
      id: 'ceo-assistant-001',
      name: 'Diana',
      role: 'CEO Assistant',
      department: 'Executive',
      capabilities: ['organization', 'summarization', 'prioritization'],
      status: 'active',
      config: {},
    },
  ]

  for (const agent of agents) {
    await db.query(
      `INSERT INTO agents (id, name, role, department, capabilities, status, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        agent.id,
        agent.name,
        agent.role,
        agent.department,
        JSON.stringify(agent.capabilities),
        agent.status,
        JSON.stringify(agent.config),
      ]
    )
    console.log(`✅ Created agent: ${agent.name} (${agent.role})`)
  }

  return agents.map((a) => a.id)
}

/**
 * Create sample content
 */
async function createSampleContent(websiteId: string, writerAgentId: string) {
  const contentId = uuidv4()

  const sampleBlocks = [
    {
      type: 'hero',
      title: 'Welcome to TechBlog',
      subtitle: 'Exploring the future of technology',
      backgroundImage: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa',
    },
    {
      type: 'heading',
      level: 2,
      text: 'The Rise of AI Agents',
    },
    {
      type: 'paragraph',
      text: 'Artificial Intelligence agents are transforming how we build and operate software systems. These autonomous entities can perform complex tasks, make decisions, and collaborate with humans in unprecedented ways.',
    },
    {
      type: 'image',
      url: 'https://images.unsplash.com/photo-1677442136019-21780ecad995',
      alt: 'AI and technology concept',
      caption: 'The future of AI-powered automation',
    },
    {
      type: 'heading',
      level: 3,
      text: 'Key Benefits',
    },
    {
      type: 'list',
      ordered: false,
      items: [
        'Autonomous operation 24/7',
        'Consistent quality and adherence to guidelines',
        'Scalable content production',
        'Reduced operational overhead',
      ],
    },
    {
      type: 'callout',
      type: 'info',
      title: 'Did You Know?',
      text: 'AI agents can process and analyze thousands of documents in seconds, extracting insights that would take humans hours or days.',
    },
    {
      type: 'heading',
      level: 3,
      text: 'Real-World Applications',
    },
    {
      type: 'paragraph',
      text: 'From content creation to customer service, AI agents are being deployed across industries. Companies are seeing dramatic improvements in efficiency and customer satisfaction.',
    },
    {
      type: 'quote',
      text: 'The future of work is collaborative intelligence - humans and AI working together to achieve more than either could alone.',
      author: 'Tech Industry Leader',
      role: 'CEO, Innovation Corp',
    },
  ]

  await db.query(
    `INSERT INTO content_items
     (id, title, slug, brief, body, status, website_id, author_agent_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      contentId,
      'The Rise of AI Agents in Modern Software',
      'rise-of-ai-agents',
      'Exploring how AI agents are transforming software development and operations',
      JSON.stringify(sampleBlocks),
      'brief_created',
      websiteId,
      writerAgentId,
      JSON.stringify({
        tags: ['AI', 'automation', 'software'],
        reading_time: '5 min',
      }),
    ]
  )

  console.log(`✅ Created sample content: ${contentId}`)
  return contentId
}

/**
 * Create sample task
 */
async function createSampleTask(contentId: string, agentId: string) {
  const taskId = uuidv4()

  await db.query(
    `INSERT INTO tasks
     (id, type, title, description, status, priority, agent_id, content_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      taskId,
      'content_creation',
      'Write article about AI agents',
      'Create comprehensive article covering AI agents, their benefits, and real-world applications',
      'planned',
      'medium',
      agentId,
      contentId,
      JSON.stringify({}),
    ]
  )

  console.log(`✅ Created sample task: ${taskId}`)
  return taskId
}

/**
 * Main seed function
 */
async function seed() {
  console.log('🌱 Seeding database...\n')

  try {
    // Connect to database
    await db.query('SELECT 1')
    console.log('✅ Database connected\n')

    // Check if already seeded
    const { rows } = await db.query('SELECT COUNT(*) as count FROM websites')
    if (parseInt(rows[0].count) > 0) {
      console.log('⚠️  Database already contains data')
      console.log('   Run scripts/clear.ts to reset before seeding\n')
      process.exit(0)
    }

    // Create data
    console.log('Creating seed data...\n')

    const websiteId = await createWebsite()
    console.log('')

    const [writerAgentId, editorAgentId, engineeringAgentId, ceoAssistantId] =
      await createAgents()
    console.log('')

    const contentId = await createSampleContent(websiteId, writerAgentId)
    console.log('')

    const taskId = await createSampleTask(contentId, writerAgentId)
    console.log('')

    console.log('✨ Seeding completed successfully!\n')
    console.log('Sample data created:')
    console.log(`  Website: ${websiteId}`)
    console.log(`  Agents: 4 (Writer, Editor, Engineering, CEO Assistant)`)
    console.log(`  Content: ${contentId}`)
    console.log(`  Task: ${taskId}`)
    console.log('')
    console.log('You can now test the system with this data!')
    console.log('')

    await db.end()
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    await db.end()
    process.exit(1)
  }
}

// Run seed
seed()
