import type { EngineInterface, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PROPS = {
  title: 'Files',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

// A fake disk, a git repo at /repo and HOME at /home/dev; Edit and Write change the disk
const fakeHost = (on: On, disk: Record<string, string>, status = '') => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: false } }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.read', (_$, e) => (e.path in disk ? { value: disk[e.path]! } : { deny: 'ENOENT' }))
  on('env.get', () => ({ value: '/home/dev' }))
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'rev-parse' ? '/repo\nmain\n' : status, stderr: '' },
  }))
  on('tool.call', (_$, e) => {
    if (e.tool === 'Edit') disk[e.file_path] = disk[e.file_path]!.replace(e.old_string, e.new_string)
    if (e.tool === 'Write') disk[e.file_path] = e.content
    return { result: {} }
  })
}

const start = ($: EngineInterface) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

const pane = async ($: EngineInterface, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'files', surface, component: 'Pane', requestId: 'files', props: PROPS })

test('an edit shows as the latest file with its line counts', async ($, on) => {
  fakeHost(on, { '/repo/src/api/client.js': 'one\na\nthree\n' })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/api/client.js' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/api/client.js', old_string: 'one\na\n', new_string: 'one\nb\nc\n' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ text: /edited/ })).toBeDefined()
    // 'one' is context in both strings, so only b and c are added and a removed
    expect(await ui.find({ text: /\+2 −1/ })).toBeDefined()
    await ui.unmount()
  }
})

test('counts are the net change since Claude first touched the file', async ($, on) => {
  fakeHost(on, { '/repo/a.ts': 'x\ny\n' })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'y', new_string: 'z' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'z', new_string: 'y' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'new\nfile\n' })
  const ui = await pane($)
  expect(await ui.find({ text: /\+0 −0/ })).toBeDefined()
  expect(await ui.find({ text: /\+2 −0/ })).toBeDefined()
  await ui.unmount()
})

test('a file outside the repo under HOME shows with ~', async ($, on) => {
  fakeHost(on, { '/home/dev/notes/todo.md': 'hi\n' })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/home/dev/notes/todo.md' })
  const ui = await pane($)
  expect(await ui.find({ text: /~\/notes\// })).toBeDefined()
  await ui.unmount()
})

test("a rename's original path is not read as a dirty file", async ($, on) => {
  // The old parser cut 'xx/lib.ts' to 'lib.ts' and so marked /repo/lib.ts dirty
  fakeHost(on, { '/repo/new.ts': '', '/repo/lib.ts': '' }, 'R  new.ts\0xx/lib.ts\0')
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/repo/new.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/lib.ts' })
  const ui = await pane($)
  expect(await ui.find({ text: /^1 file changed/ })).toBeDefined()
  await ui.unmount()
})
