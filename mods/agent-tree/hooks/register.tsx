import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Loop, Phase, Run, Todo } from '../types'

const PANE = 'agent-tree'
const MAIN = 'main'
const loops = atom({ plugin: 'agent-tree', key: 'loops' } as const, {} as Record<string, Loop>)
const run = atom({ plugin: 'agent-tree', key: 'run' } as const, null as Run | null)
const tick = atom({ plugin: 'agent-tree', key: 'tick' } as const, 0)
const isFinishedCollapsed = atom({ plugin: 'agent-tree', key: 'isFinishedCollapsed' } as const, false)

const LIVE: Phase[] = ['starting', 'thinking', 'writing', 'calling', 'tools']
const COLORS = ['suggestion', 'success', 'permission', 'planMode', 'merged', 'remember', 'autoAccept', 'ide'] as const
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// Each agent is a small Clawd: the body in Claude's color, a hat of its own in the agent's color
const BODY = ['▐▛███▜▌', '▝▜███▛▘', ' ▘▘ ▝▝ ']
const CROWN = ' ▗▙▟▙▖ '
const HATS = [' ▄▄▄▄▄▖', ' ▗███▖ ', '   ▟▙  ', '▗▛▀▀▀▜▖', ' ╻   ╻ ', '  ▐█▌  ', '  ━┳━  ', '    ▚▞ ']
const ICON_W = 7
const LABEL_KEYS = ['description', 'command', 'file_path', 'notebook_path', 'pattern', 'query', 'url', 'subject', 'skill', 'prompt']

const isLive = (l: Loop) => LIVE.includes(l.phase)

// One color per agent, from its id, so the files pane colors the same agent the same way
const agentColor = (id: string) => {
  if (id === MAIN) return 'claude'
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]!
}

const contextMeter = (used: number, window: number) => {
  const pct = Math.min(100, Math.round((used / window) * 100))
  return { text: `${pct}%`, color: pct >= 85 ? 'error' : pct >= 60 ? 'warning' : undefined }
}

const oneLine = (s: string, max = 80) => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

const describeCall = (e: object): string => {
  const x = e as Record<string, unknown>
  for (const k of LABEL_KEYS) if (typeof x[k] === 'string' && x[k]) return oneLine(x[k] as string, 60)
  return ''
}

const prettyModel = (m?: string) => {
  if (!m) return ''
  const hit = /claude-([a-z]+)-(\d+)(?:-(\d))?/.exec(m.replace(/\[.*\]$/, ''))
  const [, family = '', major = '', minor] = hit ?? []
  if (!family) return m
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${major}${minor ? '.' + minor : ''}`
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const tokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

const patch = ($: EngineInterface, id: string, fn: (l: Loop) => Loop) =>
  update($, loops, all => (all[id] ? { ...all, [id]: fn(all[id]) } : all))

const sessionCost = ($: EngineInterface) =>
  $.session.usage().then(
    u => u.cost?.usd,
    () => undefined,
  )

const refreshCost = async ($: EngineInterface) => {
  const usd = await sessionCost($)
  if (usd !== undefined) await update($, run, r => (r ? { ...r, cost: usd } : r))
}

// Main first, then each agent under its parent, depth-first
const ordered = (all: Record<string, Loop>) => {
  const list = Object.values(all)
  const out: { loop: Loop; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const l of list.filter(x => x.id !== MAIN && (x.parentId ?? MAIN) === (parent ?? MAIN))) {
      out.push({ loop: l, depth })
      walk(l.id, depth + 1)
    }
  }
  if (all[MAIN]) out.push({ loop: all[MAIN], depth: 0 })
  walk(undefined, all[MAIN] ? 1 : 0)
  const seen = new Set(out.map(o => o.loop.id))
  for (const l of list) if (!seen.has(l.id)) out.push({ loop: l, depth: 1 })
  return out
}

export const register: Register = on => {
  let statusShown = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tree', description: 'Toggle the live agent tree pane' })
    void $.ui.open({ id: PANE, title: 'Agent tree' })

    let beats = 0
    $.clock.every(1000, () => {
      void (async () => {
        const all = await read($, loops)
        const live = Object.values(all).filter(isLive)
        if (live.length === 0) {
          if (statusShown) $.ui.status(undefined)
          statusShown = false
          return
        }
        await update($, tick, n => n + 1)
        if (++beats % 3 === 0) await refreshCost($)
        const r = await read($, run)
        const agents = live.filter(l => l.id !== MAIN).length
        const total = Object.values(all).reduce((s, l) => s + l.tokens, 0)
        $.ui.status(
          `◉ ${all[MAIN] && isLive(all[MAIN]) ? all[MAIN].phase : 'working'}` +
            (agents ? ` · ${agents} agent${agents > 1 ? 's' : ''}` : '') +
            ` · ${tokens(total)} tok` +
            (r ? ` · ${clock(Date.now() - r.startedAt)}` : ''),
        )
        statusShown = true
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'tree' }, async $ => {
    const open = (await $.ui.panes()).some(p => p.id === PANE)
    if (open) {
      await $.ui.close({ id: PANE })
      return { text: 'Agent tree pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Agent tree' })
    return { text: 'Agent tree pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    const now = Date.now()
    const id = e.agentId ?? MAIN
    let type: string | undefined
    let parentId: string | undefined
    let title = oneLine(e.text) || 'Continuing'

    if (e.agentId) {
      const info = (await $.agent.list()).find(a => a.id === e.agentId)
      // Engine forks (compaction, memory) aren't listed: don't track them
      if (!info) return next(e)
      type = info.type
      parentId = info.parentId
      title = oneLine(info.description || title)
    } else {
      const usd = (await sessionCost($)) ?? 0
      await update($, run, () => ({ startedAt: now, costAtStart: usd, cost: usd }))
    }

    await update($, loops, all => {
      const kept: Record<string, Loop> = {}
      // A new prompt clears agents that finished during earlier prompts
      for (const [k, l] of Object.entries(all)) if (e.agentId || isLive(l) || k === MAIN) kept[k] = l
      const prev = kept[id]
      kept[id] = {
        id,
        title: !e.agentId && !e.text && prev ? prev.title : title,
        type: type ?? prev?.type,
        parentId: parentId ?? prev?.parentId,
        model: prev?.model,
        effort: prev?.effort,
        phase: 'starting',
        activity: undefined,
        startedAt: prev && isLive(prev) ? prev.startedAt : now,
        steps: prev && isLive(prev) ? prev.steps : 0,
        tokens: prev && (e.agentId || isLive(prev)) ? prev.tokens : 0,
        todos: prev?.todos ?? [],
        // The next hat along, so agents running together look different
        icon: prev?.icon ?? Object.values(kept).filter(l => l.id !== MAIN && l.id !== id).length % HATS.length,
      }
      return kept
    })

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? MAIN
    await patch($, id, l => ({
      ...l,
      model: e.model,
      effort: e.effort === undefined ? undefined : String(e.effort),
      steps: l.steps + 1,
      phase: 'thinking',
    }))
    let phase: Phase = 'thinking'
    for await (const c of next(e)) {
      if (c.kind === 'text' && phase !== 'writing') {
        phase = 'writing'
        await patch($, id, l => ({ ...l, phase, activity: undefined }))
      } else if (c.kind === 'tool') {
        phase = 'calling'
        await patch($, id, l => ({ ...l, phase, activity: c.name }))
      } else if (c.kind === 'stop' && c.usage) {
        const u = c.usage
        // Cache reads re-count the whole prompt on every step, so only new tokens are summed
        const n = u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0)
        // What this step's prompt filled of the window, cache reads included
        const context = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        const window =
          id === MAIN
            ? await $.session.usage().then(
                x => x.context.window,
                () => undefined,
              )
            : /\[1m\]$/.test(e.model)
              ? 1_000_000
              : 200_000
        await patch($, id, l => ({ ...l, tokens: l.tokens + n, context, window: window ?? l.window }))
      }
      yield c
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const label = describeCall(e)
    await patch($, id, l => ({ ...l, phase: 'tools', activity: label ? `${e.tool} · ${label}` : e.tool }))

    if (e.tool === 'TodoWrite') {
      const todos: Todo[] = e.todos.map((t, i) => ({ id: String(i), text: t.content, active: t.activeForm, status: t.status }))
      await patch($, id, l => ({ ...l, todos }))
    }

    const ran = await next(e)

    if (e.tool === 'TaskCreate' && ran.result && !ran.isError) {
      const task = (ran.result as { task?: { id: string } }).task
      if (task) {
        const todo: Todo = { id: task.id, text: e.subject, active: e.activeForm, status: 'pending' }
        await patch($, id, l => ({ ...l, todos: [...l.todos, todo] }))
      }
    } else if (e.tool === 'TaskUpdate' && !ran.isError) {
      const status = e.status
      await patch($, id, l => ({
        ...l,
        todos:
          status === 'deleted'
            ? l.todos.filter(t => t.id !== e.taskId)
            : l.todos.map(t =>
                t.id === e.taskId
                  ? { ...t, text: e.subject ?? t.text, active: e.activeForm ?? t.active, status: status ?? t.status }
                  : t,
              ),
      }))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const phase: Phase = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'aborted' : 'failed'
    await patch($, id, l => ({ ...l, phase, activity: undefined, endedAt: Date.now() }))
    if (!e.agentId) {
      await update($, run, r => (r ? { ...r, endedAt: Date.now() } : r))
      await refreshCost($)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, loops)
    const collapsed = await read($, isFinishedCollapsed)
    const r = await read($, run)
    const beat = await read($, tick)
    const now = Date.now()
    const width = Math.max(24, e.props.bodyColumns)
    const rows = ordered(all)
    const live = rows.filter(x => isLive(x.loop))
    const done = rows.filter(x => !isLive(x.loop))
    const total = rows.reduce((s, x) => s + x.loop.tokens, 0)
    const anyLive = live.length > 0
    const runMs = r ? (anyLive ? now : r.endedAt ?? now) - r.startedAt : 0

    const tile = (label: string, value: string) => (
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor>{label}</Text>
        <Text bold>{value}</Text>
      </Box>
    )

    const card = ({ loop, depth }: { loop: Loop; depth: number }) => {
      const color = agentColor(loop.id)
      const running = isLive(loop)
      const inner = Math.max(8, width - depth * 2 - ICON_W - 2)
      const elapsed = (loop.endedAt && !running ? loop.endedAt : now) - loop.startedAt
      const finished = loop.todos.filter(t => t.status === 'completed').length
      const current = loop.todos.find(t => t.status === 'in_progress')
      const hasTodos = loop.todos.length > 0
      const ending = loop.phase === 'done' ? 'done' : loop.phase === 'aborted' ? 'stopped' : 'failed'
      const step = hasTodos
        ? `${finished}/${loop.todos.length}` + (running ? ` · ${current ? current.active || current.text : loop.activity ?? loop.phase}` : '')
        : running
          ? loop.activity ?? loop.phase
          : ending
      const mark = running
        ? { text: SPIN[beat % SPIN.length]!, color }
        : loop.phase === 'done'
          ? { text: '✓', color: 'success' }
          : loop.phase === 'aborted'
            ? { text: '■', color: 'warning' }
            : { text: '✗', color: 'error' }
      const barColor = loop.phase === 'failed' ? 'error' : color
      let bar: [string, string, string]
      if (hasTodos || !running) {
        const n = hasTodos ? Math.round((finished / loop.todos.length) * inner) : loop.phase === 'done' ? inner : 0
        bar = ['', '━'.repeat(n), '─'.repeat(inner - n)]
      } else {
        // Indeterminate: a segment sliding across the track
        const seg = Math.max(3, Math.floor(inner / 5))
        const pos = (beat * 2) % (inner + seg) - seg
        const a = Math.max(0, pos)
        const b = Math.min(inner, pos + seg)
        bar = ['─'.repeat(a), '━'.repeat(Math.max(0, b - a)), '─'.repeat(inner - Math.max(a, b))]
      }
      const meta = [prettyModel(loop.model), loop.effort].filter(Boolean)
      const meter = loop.context && loop.window ? contextMeter(loop.context, loop.window) : undefined
      const hat = loop.id === MAIN ? CROWN : HATS[(loop.icon ?? 0) % HATS.length]!

      return (
        <Box key={loop.id} flexDirection="column" marginLeft={depth * 2}>
          <Box flexDirection="row">
            <Box flexDirection="column" width={ICON_W} marginRight={2} flexShrink={0}>
              <Text color={color}>{hat}</Text>
              {BODY.map((row, i) => (
                <Text key={String(i)} color="claude" dimColor={!running && loop.phase !== 'done'}>
                  {row}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Box justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text bold wrap="truncate-end">
                    {loop.title}
                  </Text>
                </Box>
                <Text color={mark.color}> {mark.text}</Text>
              </Box>
              <Text wrap="truncate-end">
                <Text color={color}>{loop.id === MAIN ? 'main' : loop.type ?? 'agent'}</Text>
                <Text dimColor>{meta.length ? ' ' + meta.join(' · ') : ''}</Text>
              </Text>
              <Box justifyContent="space-between">
                <Box flexShrink={1}>
                  <Text wrap="truncate-end" dimColor={!running}>
                    {step}
                  </Text>
                </Box>
                <Text dimColor>
                  {' '}
                  {meter && (
                    <Text color={meter.color} dimColor={!meter.color}>
                      ctx {meter.text} ·{' '}
                    </Text>
                  )}
                  {tokens(loop.tokens)} · {clock(elapsed)}
                </Text>
              </Box>
              <Text>
                <Text dimColor>{bar[0]}</Text>
                <Text color={barColor}>{bar[1]}</Text>
                <Text dimColor>{bar[2]}</Text>
              </Text>
            </Box>
          </Box>
          <Text dimColor>{'─'.repeat(Math.max(1, width - depth * 2))}</Text>
        </Box>
      )
    }

    // When each agent ran, on one time axis from the prompt's start, so parallel work lines up
    const timeline = () => {
      if (!r || rows.length < 2) return null
      const t0 = r.startedAt
      const ends = rows.map(x => (isLive(x.loop) ? now : x.loop.endedAt ?? now))
      const span = Math.max(1000, (anyLive ? now : Math.max(...ends)) - t0)
      const labelW = Math.min(14, Math.floor(width * 0.3))
      const barW = Math.max(8, width - labelW - 7)
      const at = (t: number) => Math.min(barW, Math.max(0, Math.round(((t - t0) / span) * barW)))
      const shown = rows.slice(0, 8)
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor bold>
            TIMELINE
          </Text>
          {shown.map(({ loop, depth }, i) => {
            const a = at(loop.startedAt)
            const b = Math.min(barW, Math.max(a + 1, at(ends[i]!)))
            const label = (' '.repeat(depth) + loop.title).slice(0, labelW).padEnd(labelW)
            const color = loop.phase === 'failed' ? 'error' : agentColor(loop.id)
            return (
              <Text key={loop.id} wrap="truncate-end">
                <Text dimColor={!isLive(loop)}>{label}</Text>{' '}
                <Text dimColor>{'·'.repeat(a)}</Text>
                <Text color={color}>{'━'.repeat(b - a)}</Text>
                <Text dimColor>{'·'.repeat(barW - b)}</Text>
                <Text dimColor>{clock(ends[i]! - Math.max(t0, loop.startedAt)).padStart(6)}</Text>
              </Text>
            )
          })}
          <Text dimColor>
            {' '.repeat(labelW + 1)}
            {'0:00'.padEnd(barW - 4)}
            {clock(span).padStart(4)}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Agent tree</Text>
        <Text dimColor wrap="truncate-end">
          {all[MAIN]?.title ?? 'Nothing has run yet'}
        </Text>
        <Box flexDirection="row" gap={1} marginTop={1}>
          {tile('Cost', r ? `≈$${Math.max(0, r.cost - r.costAtStart).toFixed(2)}` : '—')}
          {tile('Tokens', tokens(total))}
          {tile('Time', clock(runMs))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor bold>
            Running · {live.length}
          </Text>
        </Box>
        {live.length === 0 && <Text dimColor>Idle.</Text>}
        {live.map(card)}
        {done.length > 0 && (
          <Box marginTop={1}>
            <Button
              key="finished"
              plain
              dimColor
              label={`${collapsed ? '▸' : '▾'} Finished · ${done.length}`}
              onPress={() => update($, isFinishedCollapsed, c => !c)}
            />
          </Box>
        )}
        {!collapsed && done.slice(-8).map(card)}
        {timeline()}
      </Box>
    )
  })
}
