import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Loop, Phase, Run, Todo } from '../types'

const PANE = 'agent-progress'
const MAIN = 'main'
const loops = atom({ plugin: 'agent-progress', key: 'loops' } as const, {} as Record<string, Loop>)
const run = atom({ plugin: 'agent-progress', key: 'run' } as const, null as Run | null)
const tick = atom({ plugin: 'agent-progress', key: 'tick' } as const, 0)

const LIVE: Phase[] = ['starting', 'thinking', 'writing', 'calling', 'tools']
const COLORS = ['warning', 'suggestion', 'success', 'claude', 'permission', 'planMode'] as const
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const LABEL_KEYS = ['description', 'command', 'file_path', 'notebook_path', 'pattern', 'query', 'url', 'subject', 'skill', 'prompt']

const isLive = (l: Loop) => LIVE.includes(l.phase)

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
    await $.command.register({ name: 'progress', description: 'Toggle the live agent progress pane' })
    void $.ui.open({ id: PANE, title: 'Agents' })

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

  on('command.run', { command: 'progress' }, async $ => {
    const open = (await $.ui.panes()).some(p => p.id === PANE)
    if (open) {
      await $.ui.close({ id: PANE })
      return { text: 'Agent progress pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Agents' })
    return { text: 'Agent progress pane opened.' }
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
        const n = u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        await patch($, id, l => ({ ...l, tokens: l.tokens + n }))
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
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, loops)
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

    const card = ({ loop, depth }: { loop: Loop; depth: number }, i: number) => {
      const color = COLORS[i % COLORS.length]
      const inner = Math.max(8, width - depth * 2 - 4)
      const elapsed = (loop.endedAt && !isLive(loop) ? loop.endedAt : now) - loop.startedAt
      const finished = loop.todos.filter(t => t.status === 'completed').length
      const current = loop.todos.find(t => t.status === 'in_progress')
      const hasTodos = loop.todos.length > 0
      const step = hasTodos
        ? `${finished}/${loop.todos.length} · ${current ? current.active || current.text : loop.activity ?? loop.phase}`
        : loop.activity ?? loop.phase
      let bar: { fill: string; rest: string }
      if (hasTodos) {
        const n = Math.round((finished / loop.todos.length) * inner)
        bar = { fill: '━'.repeat(n), rest: '─'.repeat(inner - n) }
      } else {
        // Indeterminate: a segment sliding across the track
        const seg = Math.max(3, Math.floor(inner / 5))
        const pos = (beat * 2) % (inner + seg) - seg
        const a = Math.max(0, pos)
        const b = Math.min(inner, pos + seg)
        bar = { fill: '', rest: '─'.repeat(a) + '\u0000' + '━'.repeat(Math.max(0, b - a)) + '\u0000' + '─'.repeat(inner - Math.max(a, b)) }
      }
      const meta = [loop.id === MAIN ? 'main' : loop.type, prettyModel(loop.model), loop.effort].filter(Boolean)
      const [pre, mid, post] = bar.rest.split('\u0000')

      return (
        <Box key={loop.id} flexDirection="column" marginLeft={depth * 2} borderStyle="round" borderColor={color} paddingX={1}>
          <Box justifyContent="space-between">
            <Text bold wrap="truncate-end">
              <Text color={color}>{SPIN[beat % SPIN.length]}</Text> {loop.title}
            </Text>
            <Text color={color}>●</Text>
          </Box>
          <Text wrap="truncate-end">
            <Text color={color}>{meta[0] ?? ''}</Text>
            <Text dimColor>{meta.length > 1 ? ' ' + meta.slice(1).join(' · ') : ''}</Text>
          </Text>
          <Box justifyContent="space-between">
            <Box flexShrink={1}>
              <Text wrap="truncate-end">{step}</Text>
            </Box>
            <Text dimColor>
              {' '}
              {tokens(loop.tokens)} tok · {clock(elapsed)}
            </Text>
          </Box>
          {hasTodos ? (
            <Text>
              <Text color={color}>{bar.fill}</Text>
              <Text dimColor>{bar.rest}</Text>
            </Text>
          ) : (
            <Text>
              <Text dimColor>{pre}</Text>
              <Text color={color}>{mid ?? ''}</Text>
              <Text dimColor>{post ?? ''}</Text>
            </Text>
          )}
        </Box>
      )
    }

    const doneRow = ({ loop, depth }: { loop: Loop; depth: number }) => {
      const mark = loop.phase === 'done' ? '✓' : loop.phase === 'aborted' ? '■' : '✗'
      const color = loop.phase === 'done' ? 'success' : loop.phase === 'aborted' ? 'warning' : 'error'
      const elapsed = (loop.endedAt ?? now) - loop.startedAt
      return (
        <Box key={loop.id} justifyContent="space-between" marginLeft={depth * 2}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={color}>{mark}</Text> {loop.title}
            </Text>
          </Box>
          <Text dimColor>
            {' '}
            {tokens(loop.tokens)} · {clock(elapsed)}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Agents</Text>
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
            RUNNING · {live.length}
          </Text>
        </Box>
        {live.length === 0 && <Text dimColor>Idle.</Text>}
        {live.map((x, i) => card(x, i))}
        {done.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor bold>
              FINISHED · {done.length}
            </Text>
          </Box>
        )}
        {done.slice(-8).map(doneRow)}
      </Box>
    )
  })
}
