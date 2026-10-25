import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Task } from '../types'

const title = atom({ plugin: 'task-band', key: 'title' } as const, '')
const tasks = atom({ plugin: 'task-band', key: 'tasks' } as const, [] as Task[])
const agents = atom({ plugin: 'task-band', key: 'agents' } as const, [] as string[])
const isHidden = atom({ plugin: 'task-band', key: 'isHidden' } as const, false)
const tick = atom({ plugin: 'task-band', key: 'tick' } as const, 0)
const activity = atom({ plugin: 'task-band', key: 'activity' } as const, '')
const startedAt = atom({ plugin: 'task-band', key: 'startedAt' } as const, 0)

const ACCENT = '#8b84e8'
const INK = '#16152b'
const TITLE_MAX = 22
const PILL_MAX = 18
// Clawd's top row: the mascot in one line
const MASCOT = '▐▛█▜▌'
const FILLED = '▚▞▙▟▛▜▀▄▌▐▖▗▘▝'
const SPARSE = '·▖▗▘▝'

const oneLine = (s: string, max: number) => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// A stable pseudo-random pick per cell, so the pixels hold still between redraws
const noise = (i: number, seed: number) => {
  let h = (i * 2654435761 + seed * 40503) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 2246822519) >>> 0
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

const pixel = (i: number, seed: number, isFilled: boolean) => {
  const r = noise(i, seed)
  if (isFilled) return r < 0.15 ? ' ' : FILLED[Math.floor(r * 997) % FILLED.length]!
  return r < 0.22 ? SPARSE[Math.floor(r * 997) % SPARSE.length]! : ' '
}

const setTasks = ($: EngineInterface, fn: (all: Task[]) => Task[]) => update($, tasks, fn)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Animate only while an agent runs
    $.clock.every(450, () => {
      void (async () => {
        if ((await read($, agents)).length) await update($, tick, n => n + 1)
      })()
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId) {
      // Engine forks (compaction, memory) aren't listed: don't count them
      const info = (await $.agent.list()).find(a => a.id === e.agentId)
      if (info) await update($, agents, all => (all.includes(e.agentId!) ? all : [...all, e.agentId!]))
      return next(e)
    }

    await update($, agents, all => (all.includes('main') ? all : [...all, 'main']))
    await update($, activity, () => 'Thinking')
    if (e.text) {
      await update($, isHidden, () => false)
      await update($, startedAt, () => Date.now())
      const all = await read($, tasks)
      const isFinished = all.every(t => t.status === 'completed')
      // A new prompt after a finished list starts over
      if (all.length && isFinished) await setTasks($, () => [])
      if (isFinished) await update($, title, () => oneLine(e.text, TITLE_MAX))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    await update($, agents, all => all.filter(a => a !== id))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Only the main loop's list and steps: sub-agents keep their own
    if (e.agentId) return next(e)

    await update($, activity, () => (e.tool === 'Agent' ? 'Delegating' : e.tool))

    if (e.tool === 'TodoWrite') {
      await setTasks($, () => e.todos.map((t, i) => ({ id: String(i), text: t.content, status: t.status })))
      return next(e)
    }

    const ran = await next(e)
    await update($, activity, () => 'Thinking')

    if (e.tool === 'TaskCreate' && ran.result && !ran.isError) {
      const task = (ran.result as { task?: { id: string } }).task
      if (task) await setTasks($, all => [...all, { id: task.id, text: e.subject, status: 'pending' }])
    } else if (e.tool === 'TaskUpdate' && !ran.isError) {
      const status = e.status
      await setTasks($, all =>
        status === 'deleted'
          ? all.filter(t => t.id !== e.taskId)
          : all.map(t => (t.id === e.taskId ? { ...t, text: e.subject ?? t.text, status: status ?? t.status } : t)),
      )
    }
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, tasks)
    const live = await read($, agents)
    // With a list the band stays until the next prompt; without one, only while a turn runs
    const isShown = all.length > 0 || (e.props.isWorking && live.includes('main'))
    if (e.props.hasSurvey || !isShown || (await read($, isHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const beat = await read($, tick)
    const name = (await read($, title)) || 'Working'
    const hasList = all.length > 0
    const done = all.filter(t => t.status === 'completed').length
    const isBordered = e.props.maxRows >= 3

    const pill = hasList ? ` Tasks ${done}/${all.length} ` : ` ${oneLine((await read($, activity)) || 'Thinking', PILL_MAX)} `
    const right = hasList ? `${Math.round((done / all.length) * 100)}%`.padStart(4) : clock(Date.now() - (await read($, startedAt))).padStart(5)
    const count = live.length ? `×${live.length}` : ''
    // Dot, title and the right-hand group, each with its gap; the bar takes the rest
    const used =
      (isBordered ? 4 : 0) + 2 + name.length + 2 + 2 + right.length + 2 + MASCOT.length + (count ? 1 + count.length : 0) + 2 + 1
    const barW = Math.max(pill.length + 6, e.props.bodyColumns - used)

    // With a list the pill sits on the edge of the filled part; without one it holds the middle
    // and a lit window sweeps through the track
    const edge = Math.round((done / Math.max(1, all.length)) * barW)
    const center = hasList ? edge : Math.floor(barW / 2)
    const start = Math.min(barW - pill.length - 2, Math.max(0, center - Math.floor(pill.length / 2) - 1))
    const end = start + pill.length + 2
    const sweepW = Math.max(4, Math.floor(barW / 4))
    const sweep = ((beat * 3) % (barW + sweepW)) - sweepW
    const isLit = (i: number) => (hasList ? i < edge : i >= sweep && i < sweep + sweepW)
    const seed = e.props.isWorking ? beat : 0
    const segment = (from: number, to: number) => {
      // Runs of lit and unlit cells, each in its own color
      const runs: { lit: boolean; text: string }[] = []
      for (let i = from; i < to; i++) {
        const lit = isLit(i)
        const last = runs[runs.length - 1]
        if (last && last.lit === lit) last.text += pixel(i, seed, lit)
        else runs.push({ lit, text: pixel(i, seed, lit) })
      }
      return (
        <Text>
          {runs.map((r, i) =>
            r.lit ? (
              <Text key={String(i)} color={ACCENT}>
                {r.text}
              </Text>
            ) : (
              <Text key={String(i)} dimColor>
                {r.text}
              </Text>
            ),
          )}
        </Text>
      )
    }

    return (
      <Box
        borderStyle={isBordered ? 'round' : undefined}
        borderColor="claude"
        paddingX={isBordered ? 1 : 0}
        justifyContent="space-between"
      >
        <Text wrap="truncate-end">
          <Text color={ACCENT}>●</Text> <Text bold>{name}</Text>
          {'  '}
          {segment(0, start)}
          <Text color={ACCENT}>▐</Text>
          <Text color={INK} backgroundColor={ACCENT} bold>
            {pill}
          </Text>
          <Text color={ACCENT}>▌</Text>
          {segment(end, barW)}
          {'  '}
          <Text dimColor>{right}</Text>
          {'  '}
          <Text color="claude">{MASCOT}</Text>
          {count ? ` ${count}` : ''}
          {'  '}
        </Text>
        <Button key="close" label="✕" plain dimColor role="dismiss" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
