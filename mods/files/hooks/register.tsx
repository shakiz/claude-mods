import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentTag, FileEntry, FileOp, GitInfo } from '../types'

const PANE = 'files'
const files = atom({ plugin: 'files', key: 'files' } as const, {} as Record<string, FileEntry>)
const git = atom({ plugin: 'files', key: 'git' } as const, null as GitInfo | null)
const cwd = atom({ plugin: 'files', key: 'cwd' } as const, '')
const home = atom({ plugin: 'files', key: 'home' } as const, '')
const agents = atom({ plugin: 'files', key: 'agents' } as const, {} as Record<string, AgentTag>)

const READ_COLOR = 'suggestion'
const EDIT_COLOR = 'claude'
const DIRTY_COLOR = 'warning'
const MAIN = 'main'
const AGENT_COLORS = ['suggestion', 'success', 'permission', 'planMode', 'merged', 'remember', 'autoAccept', 'ide'] as const

// The same color agent-tree gives the agent: main is 'claude', others hash their id
const agentColor = (id: string) => {
  if (id === MAIN) return 'claude'
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AGENT_COLORS[h % AGENT_COLORS.length]!
}

const addOnce = (list: string[] | undefined, id: string) => (list?.includes(id) ? list : [...(list ?? []), id])

// Names an agent the first time it touches a file
const tagAgent = async ($: EngineInterface, id: string) => {
  if ((await read($, agents))[id]) return
  let label = 'main'
  if (id !== MAIN) {
    const info = await $.agent.list().then(
      list => list.find(a => a.id === id),
      () => undefined,
    )
    label = info?.type ?? 'agent'
  }
  await update($, agents, all => ({ ...all, [id]: { label, firstSeen: Object.keys(all).length } }))
}

// Each file's text before Claude first changed it: '' for a new file, null when unreadable
const baselines = new Map<string, string | null>()

const lines = (s: string) => (s ? s.replace(/\n$/, '').split('\n') : [])

// Lines added and removed between two texts: trims the shared start and end, then an LCS over the rest
const diffStat = (before: string, after: string) => {
  const a = lines(before)
  const b = lines(after)
  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++
  let ea = a.length
  let eb = b.length
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) ea--, eb--
  const x = a.slice(lo, ea)
  const y = b.slice(lo, eb)
  // Too big to compare line by line: count the whole changed span
  if (x.length * y.length > 4_000_000) return { added: y.length, removed: x.length }
  let prev = new Array<number>(y.length + 1).fill(0)
  for (const line of x) {
    const row = new Array<number>(y.length + 1).fill(0)
    for (let j = 0; j < y.length; j++) row[j + 1] = line === y[j] ? prev[j]! + 1 : Math.max(prev[j + 1]!, row[j]!)
    prev = row
  }
  const same = prev[y.length]!
  return { added: y.length - same, removed: x.length - same }
}

const readText = ($: EngineInterface, path: string) =>
  $.fs.read(path).then(
    t => t as string,
    () => null,
  )

const splitPath = (p: string) => {
  const i = p.lastIndexOf('/')
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

const relative = (path: string, base: string, homeDir: string) =>
  base && path.startsWith(base + '/')
    ? path.slice(base.length + 1)
    : homeDir && path.startsWith(homeDir + '/')
      ? '~' + path.slice(homeDir.length)
      : path

const refreshGit = async ($: EngineInterface) => {
  try {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'])
    if (top.exitCode !== 0) return void (await update($, git, () => null))
    const [root = '', branch = ''] = top.stdout.trim().split('\n')
    const st = await $.process.run(['git', 'status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root })
    const dirty: string[] = []
    const entries = st.stdout.split('\0')
    for (let i = 0; i < entries.length; i++) {
      const x = entries[i]!
      if (x.length > 3) dirty.push(root + '/' + x.slice(3))
      // A rename or copy is followed by its original path, which has no status
      if (x[0] === 'R' || x[0] === 'C') i++
    }
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
      editedBy: [],
      readBy: [],
    }
    return { ...all, [path]: fn({ ...prev, touchedAt: Date.now() }) }
  })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'files', description: 'Toggle the live files pane' })
    const dir = await $.session.cwd()
    await update($, cwd, () => dir)
    const homeDir = await $.env.get('HOME')
    await update($, home, () => homeDir ?? '')
    await refreshGit($)
    void $.ui.open({ id: PANE, title: 'Files' })
    $.clock.every(10_000, () => void refreshGit($))
    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    const open = (await $.ui.panes()).some(p => p.id === PANE)
    if (open) {
      await $.ui.close({ id: PANE })
      return { text: 'Files pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Files' })
    return { text: 'Files pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    let path: string | undefined
    let op: FileOp | undefined
    if (e.tool === 'Read') {
      path = e.file_path
      op = 'read'
    } else if (e.tool === 'Edit') {
      path = e.file_path
      op = 'edit'
    } else if (e.tool === 'Write') {
      path = e.file_path
      op = 'write'
    } else if (e.tool === 'NotebookEdit') {
      path = e.notebook_path
      op = 'edit'
    }
    if (!path || !op) return next(e)

    const p = path
    const kind = op
    const who = e.agentId ?? MAIN
    await tagAgent($, who)
    await touch($, p, kind, f => ({ ...f, lastOp: kind, isBusy: true, isFailed: false }))
    if (kind !== 'read' && !baselines.has(p)) baselines.set(p, (await readText($, p)) ?? '')
    const ran = await next(e)
    const failed = 'deny' in ran || ran.isError === true
    let stat: { added: number; removed: number } | undefined
    if (kind !== 'read' && !failed) {
      const after = await readText($, p)
      const before = baselines.get(p)
      if (after !== null && before != null) stat = diffStat(before, after)
    }
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
        added: stat?.added ?? f.added,
        removed: stat?.removed ?? f.removed,
        editedBy: kind !== 'read' && !failed ? addOnce(f.editedBy, who) : f.editedBy ?? [],
        readBy: kind === 'read' && !failed ? addOnce(f.readBy, who) : f.readBy ?? [],
      }),
    )
    if (kind !== 'read') await refreshGit($)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = Object.values(await read($, files))
    const repo = await read($, git)
    const base = repo?.root ?? (await read($, cwd))
    const homeDir = await read($, home)
    const tags = await read($, agents)
    const known = Object.entries(tags).sort((a, b) => a[1].firstSeen - b[1].firstSeen)
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
    const tree = [...all].sort((a, b) => relative(a.path, base, homeDir).localeCompare(relative(b.path, base, homeDir)))
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 12)
    const shown = tree.slice(0, room)

    let lastDir: string | null = null
    const rows: RenderChildren[] = []
    for (const f of shown) {
      const { dir, name } = splitPath(relative(f.path, base, homeDir))
      if (dir !== lastDir) {
        rows.push(
          <Text key={'d:' + dir} dimColor wrap="truncate-start">
            {dir ? dir + '/' : './'}
          </Text>,
        )
        lastDir = dir
      }
      const isDirty = dirty.has(f.path)
      const editors = f.editedBy ?? []
      const readers = (f.readBy ?? []).filter(id => !editors.includes(id))
      const owners = [...editors.map(id => ({ id, mark: '◆' })), ...readers.map(id => ({ id, mark: '◇' }))].slice(0, 3)
      rows.push(
        <Box key={f.path} justifyContent="space-between" paddingLeft={2}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={READ_COLOR}>{f.reads > 0 ? '●' : ' '}</Text>
              <Text color={EDIT_COLOR}>{f.edits > 0 ? '●' : ' '}</Text>
              <Text color={DIRTY_COLOR}>{isDirty ? '●' : ' '}</Text>{' '}
              {known.length > 1 &&
                owners.map(o => (
                  <Text key={o.id} color={agentColor(o.id)}>
                    {o.mark}
                  </Text>
                ))}
              {known.length > 1 && ' '}
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
                in {splitPath(relative(latest.path, base, homeDir)).dir || '.'}
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
        {known.length > 1 && (
          <Text wrap="truncate-end">
            {known.map(([id, t], i) => (
              <Text key={id}>
                {i > 0 ? '  ' : ''}
                <Text color={agentColor(id)}>◆</Text>
                <Text dimColor> {t.label}</Text>
              </Text>
            ))}
          </Text>
        )}
        <Box flexDirection="column" marginTop={1}>
          {rows}
          {tree.length > shown.length && <Text dimColor>… {tree.length - shown.length} more</Text>}
        </Box>
      </Box>
    )
  })
}
