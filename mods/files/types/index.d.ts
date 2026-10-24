export type FileOp = 'read' | 'edit' | 'write'

export type FileEntry = {
  path: string
  lastOp: FileOp
  isBusy: boolean
  isFailed: boolean
  reads: number
  edits: number
  added: number
  removed: number
  touchedAt: number
  // Agent ids, 'main' for the main conversation; may be absent in state saved by 0.2.1
  editedBy?: string[]
  readBy?: string[]
  // Agents that edited the file while another of them was still running
  conflictWith?: string[]
}

export type AgentTag = { label: string; firstSeen: number }

export type GitInfo = { root: string; branch: string; dirty: string[] }

declare module 'claude-code' {
  interface PluginState {
    'files': {
      files: Record<string, FileEntry>
      git: GitInfo | null
      cwd: string
      home: string
      agents: Record<string, AgentTag>
    }
  }
}
