import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__chat-checklist__panel'

type Snap = { items: unknown[]; attention: unknown[]; labels?: { pending: string } }

test('keeps the checklist per chat, upserts by id and alerts on a new pendency', async ($, on) => {
  let chat = 'chat-a'
  const toasts: string[] = []

  mock.clock(on)
  const disk: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete disk[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(disk) }))
  on('session.id', () => ({ value: chat }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'disabled' } }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.tool.call({
    tool: TOOL,
    checklist: [
      { id: 'a', text: 'Write the mod', status: 'doing' },
      { id: 'b', text: 'Test it' },
    ],
    attention: [{ id: 'q', text: 'Answer the question' }],
    labels: { pending: 'PENDÊNCIAS', newPending: 'Nova pendência: {text}' },
  })
  await $.tool.call({ tool: TOOL, checklist: [{ id: 'a', status: 'done' }] })

  expect((disk["chat:" + 'chat-a'] as Snap).items).toEqual([
    { id: 'a', text: 'Write the mod', status: 'done' },
    { id: 'b', text: 'Test it', status: 'todo' },
  ])
  expect(toasts).toEqual(['Nova pendência: Answer the question'])
  expect((disk['chat:chat-a'] as Snap).labels?.pending).toBe('PENDÊNCIAS')

  // Another chat starts from nothing: lists never mix.
  chat = 'chat-b'
  await $.tool.call({ tool: TOOL, checklist: [{ id: 'x', text: 'Other chat' }] })
  expect((disk["chat:" + 'chat-b'] as Snap).items).toEqual([{ id: 'x', text: 'Other chat', status: 'todo' }])
  expect((disk["chat:" + 'chat-b'] as Snap).attention).toEqual([])
  expect((disk['chat:chat-b'] as Snap).labels?.pending).toBe('PENDING')

  // Coming back to the first chat brings its list back.
  chat = 'chat-a'
  await $.tool.call({ tool: TOOL, remove: ['b'] })
  expect((disk["chat:" + 'chat-a'] as Snap).items).toEqual([{ id: 'a', text: 'Write the mod', status: 'done' }])
})
