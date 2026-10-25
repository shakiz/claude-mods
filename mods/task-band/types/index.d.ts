export type Task = { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    'task-band': {
      title: string
      tasks: Task[]
      agents: string[]
      isHidden: boolean
      tick: number
      // What the main agent is doing, and when its turn began: shown when there is no list
      activity: string
      startedAt: number
    }
  }
}
