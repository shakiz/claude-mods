import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { FileEntry, FileOp, GitInfo } from '../types'

const PANE = 'file-activity'
const files = atom({ plugin: 'file-activity', key: 'files' } as const, {} as Record<string, FileEntry>)
const git = atom({ plugin: 'file-activity', key: 'git' } as const, null as GitInfo | null)
const cwd = atom({ plugin: 'file-activity', key: 'cwd' } as const, '')

const READ_COLOR = 'suggestion'
const EDIT_COLOR = 'claude'
const DIRTY_COLOR = 'warning'

const lineCount = (s: string) => (s ? s.split('\n').length : 0)

const splitPath = (p: string) => {
  const i = p.lastIndexOf('/')
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

const relative = (path: string, base: string) =>
  base && path.startsWith(base + '/') ? path.slice(base.length + 1) : path.replace(/^\/Users\/[^/]+/, '~')

const refreshGit = async ($: EngineInterface) => {
  try {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'])
    if (top.exitCode !== 0) return void (await update($, git, () => null))
    const [root = '', branch = ''] = top.stdout.trim().split('\n')
    const st = await $.process.run(['git', 'status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root })
    const dirty = st.stdout
      .split('\0')
      .filter(x => x.length > 3)
      .map(x => root + '/' + x.slice(3))
    await update($, git, () => ({ root, branch, dirty }))
  } catch {
    await update($, git, () => null)
  }
}

const touch = (
  $: EngineInterface,
  path: string,
  op: FileOp,
  fn: (f: FileEntry) => FileEntry,
  agentId?: string,
) =>
  update($, files, all => {
    const prev: FileEntry = all[path] ?? {
      path,
      lastOp: op,
      isBusy: false,
      isFailed: false,
      reads: 0,
      edits: 0,
      added: 0,
      removed: 0,
      touchedAt: 0,
    }
    return { ...all, [path]: fn({ ...prev, agentId, touchedAt: Date.now() }) }
  })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'files', description: 'Toggle the live file activity pane' })
    const dir = await $.session.cwd()
    await update($, cwd, () => dir)
    await refreshGit($)
    void $.ui.open({ id: PANE, title: 'Files' })
    $.clock.every(10_000, () => void refreshGit($))
    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    const open = (await $.ui.panes()).some(p => p.id === PANE)
    if (open) {
      await $.ui.close({ id: PANE })
      return { text: 'File activity pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Files' })
    return { text: 'File activity pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    let path: string | undefined
    let op: FileOp | undefined
    let added = 0
    let removed = 0
    if (e.tool === 'Read') {
      path = e.file_path
      op = 'read'
    } else if (e.tool === 'Edit') {
      path = e.file_path
      op = 'edit'
      added = lineCount(e.new_string)
      removed = lineCount(e.old_string)
    } else if (e.tool === 'Write') {
      path = e.file_path
      op = 'write'
      added = lineCount(e.content)
    } else if (e.tool === 'NotebookEdit') {
      path = e.notebook_path
      op = 'edit'
      added = lineCount(e.new_source)
    }
    if (!path || !op) return next(e)

    const p = path
    const kind = op
    await touch($, p, kind, f => ({ ...f, lastOp: kind, isBusy: true, isFailed: false }), e.agentId)
    const ran = await next(e)
    const failed = 'deny' in ran || ran.isError === true
    await touch(
      $,
      p,
      kind,
      f => ({
        ...f,
        isBusy: false,
        isFailed: failed,
        reads: f.reads + (kind === 'read' && !failed ? 1 : 0),
        edits: f.edits + (kind !== 'read' && !failed ? 1 : 0),
        added: f.added + (kind !== 'read' && !failed ? added : 0),
        removed: f.removed + (kind !== 'read' && !failed ? removed : 0),
      }),
      e.agentId,
    )
    if (kind !== 'read') await refreshGit($)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = Object.values(await read($, files))
    const repo = await read($, git)
    const base = repo?.root ?? (await read($, cwd))
    const width = Math.max(24, e.props.bodyColumns)
    const dirty = new Set(repo?.dirty ?? [])

    const busy = all.filter(f => f.isBusy).sort((a, b) => b.touchedAt - a.touchedAt)[0]
    const latest = busy ?? [...all].sort((a, b) => b.touchedAt - a.touchedAt)[0]
    const verb = (f: FileEntry) =>
      f.isBusy
        ? f.lastOp === 'read'
          ? 'is reading'
          : f.lastOp === 'write'
            ? 'is writing'
            : 'is editing'
        : f.lastOp === 'read'
          ? 'read'
          : f.isFailed
            ? 'failed to edit'
            : 'edited'
    const changed = all.filter(f => f.edits > 0 || dirty.has(f.path)).length
    const tree = [...all].sort((a, b) => relative(a.path, base).localeCompare(relative(b.path, base)))
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 12)
    const shown = tree.slice(0, room)

    let lastDir: string | null = null
    const rows: RenderChildren[] = []
    for (const f of shown) {
      const { dir, name } = splitPath(relative(f.path, base))
      if (dir !== lastDir) {
        rows.push(
          <Text key={'d:' + dir} dimColor wrap="truncate-start">
            {dir ? dir + '/' : './'}
          </Text>,
        )
        lastDir = dir
      }
      const isDirty = dirty.has(f.path)
      rows.push(
        <Box key={f.path} justifyContent="space-between" paddingLeft={2}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={READ_COLOR}>{f.reads > 0 ? '●' : ' '}</Text>
              <Text color={EDIT_COLOR}>{f.edits > 0 ? '●' : ' '}</Text>
              <Text color={DIRTY_COLOR}>{isDirty ? '●' : ' '}</Text>{' '}
              <Text bold={f.isBusy} color={f.isFailed ? 'error' : f.isBusy ? EDIT_COLOR : undefined}>
                {name}
              </Text>
            </Text>
          </Box>
          <Text dimColor>
            {f.isBusy
              ? ` ${f.lastOp === 'read' ? 'reading' : 'editing'}…`
              : f.edits > 0
                ? ` +${f.added} −${f.removed}`
                : ''}
          </Text>
        </Box>,
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box borderStyle="round" borderColor={latest?.lastOp === 'read' ? READ_COLOR : EDIT_COLOR} paddingX={1}>
            <Text color={latest?.lastOp === 'read' ? READ_COLOR : EDIT_COLOR}>{latest?.lastOp === 'read' ? '◉' : '✎'}</Text>
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Text color={READ_COLOR} bold>
              {busy ? 'RIGHT NOW' : latest ? 'LAST' : 'IDLE'}
            </Text>
            {latest ? (
              <Text bold wrap="truncate-end">
                Claude {verb(latest)}{' '}
                <Text color={latest.isFailed ? 'error' : EDIT_COLOR}>{splitPath(latest.path).name}</Text>
              </Text>
            ) : (
              <Text bold>No files touched yet</Text>
            )}
            {latest && (
              <Text dimColor wrap="truncate-start">
                in {splitPath(relative(latest.path, base)).dir || '.'}
              </Text>
            )}
          </Box>
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Box justifyContent="space-between">
          <Text>
            <Text color={READ_COLOR}>⑂</Text> <Text bold>{repo?.branch ?? 'no git'}</Text>
          </Text>
          <Text dimColor>
            {changed} file{changed === 1 ? '' : 's'} changed
          </Text>
        </Box>
        <Text>
          <Text color={READ_COLOR}>●</Text>
          <Text dimColor> read  </Text>
          <Text color={EDIT_COLOR}>●</Text>
          <Text dimColor> edited  </Text>
          <Text color={DIRTY_COLOR}>●</Text>
          <Text dimColor> not committed</Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {rows}
          {tree.length > shown.length && <Text dimColor>… {tree.length - shown.length} more</Text>}
        </Box>
      </Box>
    )
  })
}
