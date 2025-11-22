import chalk from 'chalk'

export const agentCommands = {
  async invoke(agent: string, tool: string, payload?: string) {
    console.log(chalk.cyan('Invoking agent:'), `${agent}.${tool}`)
    if (payload) {
      console.log(chalk.gray('Payload:'), payload)
    }
    // TODO Phase 3: Implement agent invocation
    console.log(chalk.yellow('⚠️  Not implemented yet (Phase 3)'))
  },

  async list() {
    console.log(chalk.cyan('Registered agents:'))
    const agents = [
      'WriterAgent',
      'EditorAgent',
      'EngineeringAgent',
      'CEOAssistantAgent',
    ]
    agents.forEach((agent) => {
      console.log(chalk.gray(`  - ${agent}`))
    })
    console.log(chalk.yellow('\n⚠️  Full agent registry not implemented yet (Phase 3)'))
  },
}
