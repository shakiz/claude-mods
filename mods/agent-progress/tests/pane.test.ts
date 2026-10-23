import { expect, test } from 'claude-code/testing'

const PROPS = {
  title: 'Agents',
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
    const ui = await $.ui.mount({ plugin: 'agent-progress', surface, component: 'Pane', requestId: 'agent-progress', props: PROPS })
    expect(await ui.find({ text: /RUNNING · 1/ })).toBeDefined()
    expect(await ui.find({ text: /1\/2 · Building pricing/ })).toBeDefined()
    await ui.unmount()
  }
})
