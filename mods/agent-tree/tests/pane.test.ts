import { expect, test } from 'claude-code/testing'

const PROPS = {
  title: 'Agent tree',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('a running turn shows as a card with todo progress', async ($, on) => {
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'Build the landing page', turnId: 't1' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Hero', status: 'completed', activeForm: 'Building hero' },
      { content: 'Pricing', status: 'in_progress', activeForm: 'Building pricing' },
    ],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface, component: 'Pane', requestId: 'agent-tree', props: PROPS })
    expect(await ui.find({ text: /RUNNING · 1/ })).toBeDefined()
    expect(await ui.find({ text: /1\/2 · Building pricing/ })).toBeDefined()
    await ui.unmount()
  }
})

test('tokens count new input and output, not cache reads', async ($, on) => {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    yield {
      kind: 'stop' as const,
      stopReason: 'end_turn' as const,
      usage: { model: e.model, input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 500, cache_read_input_tokens: 90_000 },
    }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
  })
  await $.turn.start({ text: 'Summarize', turnId: 't1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5' })) void _
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS })
  expect(await ui.find({ text: /2k tok/ })).toBeDefined()
  expect(await ui.find({ text: /92k/ })).toBeUndefined()
  await ui.unmount()
})

test("a card shows how much of its model's context window is used", async ($, on) => {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Find auth code', type: 'Explore', status: 'running' as const }] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('turn.step', async function* (_$, e) {
    yield {
      kind: 'stop' as const,
      stopReason: 'tool_use' as const,
      usage: { model: e.model, input_tokens: 10_000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 140_000 },
    }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
  })
  await $.turn.start({ text: 'Fix login', turnId: 't1' })
  await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]' })) void _
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', agentId: 'a1' })) void _
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface, component: 'Pane', requestId: 'agent-tree', props: PROPS })
    // main: 150k of the session's 1M window; the sub-agent: 150k of a 200k window
    expect(await ui.find({ text: /ctx ▰▱▱▱▱ 15%/ })).toBeDefined()
    expect(await ui.find({ text: /ctx ▰▰▰▰▱ 75%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the timeline shows one bar per agent once a sub-agent has run', async ($, on) => {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Find auth code', type: 'Explore', status: 'completed' as const },
      { id: 'a2', description: 'Write login tests', type: 'general-purpose', status: 'running' as const },
    ],
  }))
  await $.turn.start({ text: 'Fix login', turnId: 't1' })
  let ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS })
  expect(await ui.find({ text: /TIMELINE/ })).toBeUndefined()
  await ui.unmount()
  await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
  await $.turn.complete({ turnId: 't2', agentId: 'a1', reason: 'answer', answer: '' })
  await $.turn.start({ text: '', turnId: 't3', agentId: 'a2' })
  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await $.ui.mount({ plugin: 'agent-tree', surface, component: 'Pane', requestId: 'agent-tree', props: PROPS })
    expect(await ui.find({ text: /TIMELINE/ })).toBeDefined()
    expect(await ui.find({ text: /^ Find auth cod ━·+\s+0:00$/ })).toBeDefined()
    expect(await ui.find({ text: /^ Write login t ━·+\s+0:00$/ })).toBeDefined()
    expect(await ui.find({ text: /^\s+0:00\s+0:01$/ })).toBeDefined()
    await ui.unmount()
  }
})
