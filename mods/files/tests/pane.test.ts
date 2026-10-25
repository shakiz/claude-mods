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
type Agent = { id: string; type: string; status: 'running' | 'completed' }
const WRITER: Agent = { id: 'a1', type: 'general-purpose', status: 'running' }

const fakeHost = (on: On, disk: Record<string, string>, status = '', agents: Agent[] = [WRITER]) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: false } }))
  on('agent.list', () => ({ value: agents.map(a => ({ ...a, description: a.type })) }))
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

test('files show which agents edited or read them once more than one agent is at work', async ($, on) => {
  fakeHost(on, { '/repo/a.ts': 'x\n', '/repo/b.ts': 'y\n' })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'x', new_string: 'z' })
  let ui = await pane($)
  // One agent alone: no legend
  expect(await ui.find({ text: /general-purpose/ })).toBeUndefined()
  await ui.unmount()
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/b.ts', old_string: 'y', new_string: 'w', agentId: 'a1' })
  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await pane($, surface)
    expect(await ui.find({ text: /◆ main  ◆ general-purpose/ })).toBeDefined()
    expect(await ui.find({ text: /◆◇ a\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /◆ b\.ts/ })).toBeDefined()
    await ui.unmount()
  }
})

test('two running agents editing one file are flagged, with a toast', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const agents: Agent[] = [WRITER, { id: 'a2', type: 'Explore', status: 'running' }]
  fakeHost(on, { '/repo/a.ts': 'x\n', '/repo/b.ts': 'y\n' }, '', agents)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'x', new_string: 'z', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'z', new_string: 'w', agentId: 'a2' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'w', new_string: 'v', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/b.ts', old_string: 'y', new_string: 'q', agentId: 'a2' })
  expect(toasts).toEqual(['⚠ a.ts is being edited by general-purpose and Explore at the same time'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ text: /! 1 file edited by agents running at the same time/ })).toBeDefined()
    expect(await ui.find({ text: /! a\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /! b\.ts/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('editing a file after the agent that edited it has finished is not a conflict', async ($, on) => {
  const agents: Agent[] = [{ ...WRITER, status: 'completed' }]
  fakeHost(on, { '/repo/a.ts': 'x\n' }, '', agents)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'x', new_string: 'z', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'z', new_string: 'w' })
  const ui = await pane($)
  expect(await ui.find({ text: /! / })).toBeUndefined()
  await ui.unmount()
})
