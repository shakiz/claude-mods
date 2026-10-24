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
