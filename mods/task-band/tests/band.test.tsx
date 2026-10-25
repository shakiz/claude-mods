import { expect, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 110, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const start = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Docs', type: 'Explore', status: 'running' as const }] }))
  await $.turn.start({ text: 'Launch kit', turnId: 't1' })
  await $.turn.start({ text: 'Docs', turnId: 't2', agentId: 'a1' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Hero', status: 'completed', activeForm: 'Hero' },
      { content: 'Pricing', status: 'completed', activeForm: 'Pricing' },
      { content: 'FAQ', status: 'in_progress', activeForm: 'FAQ' },
      { content: 'Deploy', status: 'pending', activeForm: 'Deploy' },
    ],
  })
}

test('the band shows the title, task count, percent and running agents', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ plugin: 'task-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /Launch kit/ })).toBeDefined()
  expect(await ui.find({ text: /Tasks 2\/4/ })).toBeDefined()
  expect(await ui.find({ text: /50%/ })).toBeDefined()
  expect(await ui.find({ text: /×2/ })).toBeDefined()
  await ui.unmount()
})

test('close hides the band', async ($, on) => {
  // Stands for the engine's own band, drawn once the mod passes
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($, on)
  const ui = await $.ui.mount({ plugin: 'task-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'close' })
  expect(await ui.find({ text: /Tasks 2\/4/ })).toBeUndefined()
  await ui.unmount()
})
