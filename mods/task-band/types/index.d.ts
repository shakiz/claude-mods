export type Task = { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    'task-band': {
      title: string
      tasks: Task[]
      agents: string[]
      isHidden: boolean
      tick: number
    }
  }
}
