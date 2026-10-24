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
  agentId?: string
  touchedAt: number
}

export type GitInfo = { root: string; branch: string; dirty: string[] }

declare module 'claude-code' {
  interface PluginState {
    'files': {
      files: Record<string, FileEntry>
      git: GitInfo | null
      cwd: string
      home: string
    }
  }
}
