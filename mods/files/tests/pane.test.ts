import { expect, test } from 'claude-code/testing'

const PROPS = {
  title: 'Files',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('an edit shows as the latest file with its line counts', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/api/client.js' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/api/client.js', old_string: 'a', new_string: 'b\nc' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'files', surface, component: 'Pane', requestId: 'files', props: PROPS })
    expect(await ui.find({ text: /edited/ })).toBeDefined()
    expect(await ui.find({ text: /\+2 −1/ })).toBeDefined()
    await ui.unmount()
  }
})
