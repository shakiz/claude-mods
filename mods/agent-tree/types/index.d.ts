export type Phase = 'starting' | 'thinking' | 'writing' | 'calling' | 'tools' | 'done' | 'failed' | 'aborted'

export type Todo = { id: string; text: string; active?: string; status: 'pending' | 'in_progress' | 'completed' }

export type Loop = {
  id: string
  title: string
  type?: string
  parentId?: string
  model?: string
  effort?: string
  phase: Phase
  activity?: string
  startedAt: number
  endedAt?: number
  steps: number
  tokens: number
  context?: number
  window?: number
  todos: Todo[]
  // Which hat the agent's icon wears, in the order agents started
  icon?: number
  // Files the agent read and edited, and whether it ran a git commit
  touched?: string[]
  edited?: string[]
  isCommitted?: boolean
}

export type Run = { startedAt: number; endedAt?: number; costAtStart: number; cost: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': {
      loops: Record<string, Loop>
      run: Run | null
      tick: number
      isFinishedCollapsed: boolean
    }
  }
}
