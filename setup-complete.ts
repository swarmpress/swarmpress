/**
 * Complete setup for swarm.press with cinqueterre.travel
 * Initializes roles, departments, agents, and the cinqueterre website
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '.env') })

import { db } from './packages/backend/src/db/connection'
import { v4 as uuidv4 } from 'uuid'

async function setupComplete() {
  console.log('🐝 Setting up swarm.press with cinqueterre.travel\n')

  try {
    // ========================================================================
    // 1. Create Roles
    // ========================================================================
    console.log('📝 Step 1: Creating roles...')

    const roles = [
      { name: 'Writer', description: 'Creates content drafts and articles' },
      { name: 'Editor', description: 'Reviews and approves content' },
      { name: 'Engineer', description: 'Manages technical infrastructure' },
      { name: 'CEO Assistant', description: 'Handles high-level decisions and strategy' },
    ]

    const roleIds: Record<string, string> = {}
    for (const role of roles) {
      const roleId = uuidv4()
      roleIds[role.name] = roleId
      await db.query(
        `INSERT INTO roles (id, name, description) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        [roleId, role.name, role.description]
      )
      console.log(`   ✅ ${role.name}`)
    }

    // ========================================================================
    // 2. Create Departments
    // ========================================================================
    console.log('\n📝 Step 2: Creating departments...')

    const departments = [
      { name: 'Editorial', description: 'Content creation and editorial oversight' },
      { name: 'Engineering', description: 'Technical operations and infrastructure' },
      { name: 'Executive', description: 'Strategic leadership and oversight' },
    ]

    const deptIds: Record<string, string> = {}
    for (const dept of departments) {
      const deptId = uuidv4()
      deptIds[dept.name] = deptId
      await db.query(
        `INSERT INTO departments (id, name, description) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        [deptId, dept.name, dept.description]
      )
      console.log(`   ✅ ${dept.name}`)
    }

    // ========================================================================
    // 3. Create Agents
    // ========================================================================
    console.log('\n📝 Step 3: Creating AI agents...')

    const agents = [
      {
        name: 'Alex',
        role: 'Writer',
        department: 'Editorial',
        persona: 'Creative and detail-oriented content writer specializing in travel and lifestyle content',
        capabilities: ['content_creation', 'research', 'seo_optimization', 'storytelling'],
        email: 'alex@swarm.press',
      },
      {
        name: 'Jordan',
        role: 'Editor',
        department: 'Editorial',
        persona: 'Experienced editor focused on quality, clarity, and engaging storytelling',
        capabilities: ['editorial_review', 'content_improvement', 'quality_assurance', 'fact_checking'],
        email: 'jordan@swarm.press',
      },
      {
        name: 'Morgan',
        role: 'Engineer',
        department: 'Engineering',
        persona: 'Technical expert managing site building, deployment, and infrastructure',
        capabilities: ['site_building', 'deployment', 'technical_optimization', 'troubleshooting'],
        email: 'morgan@swarm.press',
      },
      {
        name: 'Casey',
        role: 'CEO Assistant',
        department: 'Executive',
        persona: 'Strategic thinker handling high-level decisions, planning, and coordination',
        capabilities: ['strategy', 'planning', 'coordination', 'decision_making'],
        email: 'casey@swarm.press',
      },
    ]

    const agentIds: Record<string, string> = {}
    for (const agent of agents) {
      const agentId = uuidv4()
      agentIds[agent.name] = agentId
      await db.query(
        `INSERT INTO agents (id, name, role_id, department_id, persona, virtual_email, capabilities)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          agentId,
          agent.name,
          roleIds[agent.role],
          deptIds[agent.department],
          agent.persona,
          agent.email,
          agent.capabilities,
        ]
      )
      console.log(`   ✅ ${agent.name} (${agent.role})`)
    }

    // ========================================================================
    // 4. Create Cinqueterre.travel Website
    // ========================================================================
    console.log('\n📝 Step 4: Creating cinqueterre.travel website...')

    const websiteId = uuidv4()
    await db.query(
      `INSERT INTO websites (id, domain, title, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (domain) DO UPDATE SET title = EXCLUDED.title`,
      [
        websiteId,
        'cinqueterre.travel',
        'Cinqueterre.travel - Your Guide to the Italian Riviera',
        'The ultimate travel guide to Cinque Terre, featuring village guides, hiking trails, local cuisine, and insider tips for exploring this stunning Italian coastal region.',
      ]
    )

    console.log('✅ Website created:', websiteId)
    console.log('   Domain: cinqueterre.travel')
    console.log('   GitHub: https://github.com/swarmpress/cinqueterre.travel.git')

    // ========================================================================
    // 5. Create Initial Content Ideas
    // ========================================================================
    console.log('\n📝 Step 5: Creating initial content ideas...')

    const contentTopics = [
      {
        type: 'article',
        title: 'Ultimate Guide to Visiting Cinque Terre',
        description: 'Comprehensive guide covering all five villages, best times to visit, and essential travel tips',
      },
      {
        type: 'article',
        title: 'The Five Villages of Cinque Terre Explained',
        description: 'Detailed exploration of Monterosso, Vernazza, Corniglia, Manarola, and Riomaggiore',
      },
      {
        type: 'article',
        title: 'Best Hiking Trails in Cinque Terre',
        description: 'Complete guide to hiking trails including Sentiero Azzurro and Via dell\'Amore',
      },
      {
        type: 'article',
        title: 'Where to Eat in Cinque Terre: Local Food Guide',
        description: 'Best restaurants, trattorias, and local specialties',
      },
      {
        type: 'article',
        title: 'Best Time to Visit Cinque Terre',
        description: 'Seasonal guide with weather, crowds, and events',
      },
    ]

    const contentIds = []
    const alexId = agentIds['Alex']

    for (const topic of contentTopics) {
      const contentId = uuidv4()
      contentIds.push(contentId)

      await db.query(
        `INSERT INTO content_items (id, website_id, type, body, metadata, author_agent_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          contentId,
          websiteId,
          topic.type,
          JSON.stringify([]),
          JSON.stringify({ title: topic.title, description: topic.description }),
          alexId,
          'idea',
        ]
      )

      console.log(`   ✅ ${topic.title}`)
    }

    // ========================================================================
    // 6. Create Initial Tasks
    // ========================================================================
    console.log('\n📝 Step 6: Creating initial tasks for agents...')

    // Create brief creation tasks for first 2 articles
    for (let i = 0; i < Math.min(2, contentIds.length); i++) {
      const taskId = uuidv4()
      await db.query(
        `INSERT INTO tasks (id, type, agent_id, content_id, website_id, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          taskId,
          'create_brief',
          alexId,
          contentIds[i],
          websiteId,
          'pending',
          'Create a detailed content brief for this Cinque Terre travel guide article',
        ]
      )
    }

    console.log(`   ✅ Created 2 brief creation tasks`)

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n🎉 Setup complete!\n')
    console.log('📊 Summary:')
    console.log(`   • Roles: ${roles.length}`)
    console.log(`   • Departments: ${departments.length}`)
    console.log(`   • Agents: ${agents.length}`)
    console.log('   • Website: cinqueterre.travel')
    console.log(`   • Content ideas: ${contentTopics.length}`)
    console.log('   • Initial tasks: 2')
    console.log('\n🚀 Next steps:')
    console.log('   1. Clone repository: git clone https://github.com/swarmpress/cinqueterre.travel.git')
    console.log('   2. Start content workflow using Temporal or CLI')
    console.log('   3. Agents will create briefs, write drafts, and publish content')
    console.log('\n💡 Dashboard: http://localhost:3001')
    console.log('💡 API: http://localhost:3000')

    // Log agent IDs for reference
    console.log('\n📋 Agent IDs:')
    for (const [name, id] of Object.entries(agentIds)) {
      console.log(`   • ${name}: ${id}`)
    }

  } catch (error) {
    console.error('❌ Setup failed:', error)
    throw error
  } finally {
    await db.close()
  }
}

// Run setup
setupComplete().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
