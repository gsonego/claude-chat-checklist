import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  AttentionItem,
  ChatSnapshot,
  ChecklistItem,
  ChecklistStatus,
  DecisionItem,
  Prefs,
} from '../types'

const PANE = 'chat-checklist'
const TOOL = 'mcp__chat-checklist__painel'
const MAX_CHATS = 60
const MAX_ROWS = 100

const chatId = atom({ plugin: 'chat-checklist', key: 'chatId' } as const, '')
const items = atom({ plugin: 'chat-checklist', key: 'items' } as const, [])
const attention = atom({ plugin: 'chat-checklist', key: 'attention' } as const, [])
const decisions = atom({ plugin: 'chat-checklist', key: 'decisions' } as const, [])
const isDismissed = atom({ plugin: 'chat-checklist', key: 'isDismissed' } as const, false)
const isAlertOn = atom({ plugin: 'chat-checklist', key: 'isAlertOn' } as const, true)
const isShowingResolved = atom(
  { plugin: 'chat-checklist', key: 'isShowingResolved' } as const,
  false,
)
const isShowingDecisions = atom(
  { plugin: 'chat-checklist', key: 'isShowingDecisions' } as const,
  false,
)

const INSTRUCTIONS = `A side panel beside the conversation shows the user a live, per-chat summary of this chat: a checklist, the things only the user can do or decide, and the decisions made. Keep it current with the ${TOOL} tool.

- Use it whenever the work has more than one step, leaves anything open, or needs something from the user. Skip it for a trivial one-step request.
- checklist: the steps of what is being done in this chat. Short items (under 80 characters), in the language the user writes in, with a stable id of your choosing. Set a step to "doing" when you start it and to "done" as soon as it is finished. Add steps as they are discovered.
- attention: only what requires the user (approve, answer, provide something, run or check something themselves). Set resolved: true once it no longer needs them. These raise an alert, so keep it for things that really block or need a human.
- decisions: one line per choice the user and you settled on, so it is not lost in the scroll.
- The panel is the place for this state: do not repeat the whole checklist in your replies, do not mention the tool, and make the call alongside your other work rather than narrating it.`

type PainelInput = {
  checklist?: { id?: unknown; text?: unknown; status?: unknown }[]
  attention?: { id?: unknown; text?: unknown; resolved?: unknown }[]
  decisions?: { id?: unknown; text?: unknown }[]
  remove?: unknown
  reset?: unknown
}

const isStatus = (value: unknown): value is ChecklistStatus =>
  value === 'todo' || value === 'doing' || value === 'done'

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 240) : undefined

const asId = (value: unknown): string | undefined => {
  const id = asText(value)

  return id === undefined ? undefined : id.slice(0, 64)
}

/** Upserts `patch` into `list` by id: a known id is merged, a new one is appended. */
function upsert<T extends { id: string }, P extends { id?: unknown }>(
  list: T[],
  patch: P[] | undefined,
  make: (one: P, id: string, old: T | undefined) => T | undefined,
): T[] {
  const next = [...list]

  for (const one of Array.isArray(patch) ? patch : []) {
    const id = asId(one?.id)

    if (id === undefined) {
      continue
    }

    const at = next.findIndex(known => known.id === id)
    const made = make(one, id, at >= 0 ? next[at] : undefined)

    if (made === undefined) {
      continue
    }

    if (at >= 0) {
      next[at] = made
    } else {
      next.push(made)
    }
  }

  return next.slice(-MAX_ROWS)
}

async function save($: EngineInterface) {
  const snapshot: ChatSnapshot = {
    items: await read($, items),
    attention: await read($, attention),
    decisions: await read($, decisions),
    isDismissed: await read($, isDismissed),
    updatedAt: await $.clock.now(),
  }

  await $.store.set(`chat:${await $.session.id()}`, snapshot)
}

async function savePrefs($: EngineInterface) {
  const prefs: Prefs = {
    isAlertOn: await read($, isAlertOn),
    isShowingDecisions: await read($, isShowingDecisions),
  }

  await $.store.set('prefs', prefs)
}

async function openIfWanted($: EngineInterface) {
  const hasRows = (await read($, items)).length + (await read($, attention)).length > 0

  if (hasRows && !(await read($, isDismissed))) {
    await $.ui.open({ id: PANE, title: 'Checklist' })
  }
}

// The chat in view may change under us (/clear, /resume): load the one the session is on.
async function ensureChat($: EngineInterface) {
  const id = await $.session.id()

  if ((await read($, chatId)) === id) {
    return
  }

  const snapshot = (await $.store.get(`chat:${id}`)) as ChatSnapshot | undefined

  await update($, chatId, () => id)
  await update($, items, () => snapshot?.items ?? [])
  await update($, attention, () => snapshot?.attention ?? [])
  await update($, decisions, () => snapshot?.decisions ?? [])
  await update($, isDismissed, () => snapshot?.isDismissed ?? false)
  await openIfWanted($)
}

async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(key => key.startsWith('chat:'))

  if (keys.length <= MAX_CHATS) {
    return
  }

  const aged: { key: string; at: number }[] = []

  for (const key of keys) {
    const snapshot = (await $.store.get(key)) as ChatSnapshot | undefined
    aged.push({ key, at: snapshot?.updatedAt ?? 0 })
  }

  aged.sort((a, b) => a.at - b.at)

  for (const old of aged.slice(0, aged.length - MAX_CHATS)) {
    await $.store.delete(old.key)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const prefs = (await $.store.get('prefs')) as Prefs | undefined

    await update($, isAlertOn, () => prefs?.isAlertOn ?? true)
    await update($, isShowingDecisions, () => prefs?.isShowingDecisions ?? false)

    await $.command.register({
      name: 'checklist',
      description: 'Abre ou fecha o painel de checklist deste chat',
    })
    await $.tool.register({
      name: 'painel',
      description:
        "Updates the side panel that shows the user this chat's checklist, what needs the user, and decisions made. Upserts entries by id; call it as the work progresses.",
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          checklist: {
            type: 'array',
            description: 'Steps of the work in this chat. Existing ids are updated, new ids added.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable short id, e.g. "api-tests"' },
                text: { type: 'string', description: 'Short label, in the user\'s language' },
                status: { type: 'string', enum: ['todo', 'doing', 'done'] },
              },
              required: ['id'],
            },
          },
          attention: {
            type: 'array',
            description: 'Things only the user can do or decide. Raises an alert when new.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                resolved: { type: 'boolean', description: 'true once it no longer needs the user' },
              },
              required: ['id'],
            },
          },
          decisions: {
            type: 'array',
            description: 'Choices settled in this chat, one line each.',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, text: { type: 'string' } },
              required: ['id', 'text'],
            },
          },
          remove: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids to delete from any section.',
          },
          reset: {
            type: 'boolean',
            description: 'Clear everything first (a new subject in the same chat).',
          },
        },
      },
    })

    await ensureChat($)
    await prune($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, chatId, () => '')
      await update($, items, () => [])
      await update($, attention, () => [])
      await update($, decisions, () => [])
      await update($, isDismissed, () => false)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await ensureChat($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)

    return {
      sections: [
        ...sections,
        { id: 'chat-checklist:usage', text: INSTRUCTIONS, scope: 'session' as const },
      ],
    }
  })

  on('tool.check', { tool: TOOL }, () => ({ decision: 'allow' as const }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    await ensureChat($)

    const input = e as unknown as PainelInput
    const wasOpen = new Set(
      (await read($, attention)).filter(one => !one.isResolved).map(one => one.id),
    )
    const removed = new Set(
      Array.isArray(input.remove) ? input.remove.map(asId).filter(Boolean) : [],
    )

    if (input.reset === true) {
      await update($, items, () => [])
      await update($, attention, () => [])
      await update($, decisions, () => [])
    }

    await update($, items, list =>
      upsert<ChecklistItem, NonNullable<PainelInput['checklist']>[number]>(
        list,
        input.checklist,
        (one, id, old) => {
          const text = asText(one.text) ?? old?.text

          return text === undefined && old === undefined
            ? { id, text: id, status: isStatus(one.status) ? one.status : 'todo' }
            : {
                id,
                text: text ?? id,
                status: isStatus(one.status) ? one.status : (old?.status ?? 'todo'),
              }
        },
      ).filter(one => !removed.has(one.id)),
    )
    await update($, attention, list =>
      upsert<AttentionItem, NonNullable<PainelInput['attention']>[number]>(
        list,
        input.attention,
        (one, id, old) => ({
          id,
          text: asText(one.text) ?? old?.text ?? id,
          isResolved: typeof one.resolved === 'boolean' ? one.resolved : (old?.isResolved ?? false),
        }),
      ).filter(one => !removed.has(one.id)),
    )
    await update($, decisions, list =>
      upsert<DecisionItem, NonNullable<PainelInput['decisions']>[number]>(
        list,
        input.decisions,
        (one, id, old) => ({ id, text: asText(one.text) ?? old?.text ?? id }),
      ).filter(one => !removed.has(one.id)),
    )

    const nowItems = await read($, items)
    const nowAttention = await read($, attention)
    const open = nowAttention.filter(one => !one.isResolved)
    const fresh = open.filter(one => !wasOpen.has(one.id))

    await save($)
    await openIfWanted($)

    if (fresh.length > 0 && (await read($, isAlertOn))) {
      const text = `Nova pendência: ${fresh[0].text}`
      $.ui.toast(text)
      void $.ui.notify(text, { title: 'Checklist' }).catch(() => undefined)
    }

    const done = nowItems.filter(one => one.status === 'done').length
    const summary = `Painel atualizado: ${done}/${nowItems.length} concluídos, ${open.length} pendência(s) do usuário.`

    return { result: summary }
  })

  on('command.run', { command: 'checklist' }, async $ => {
    await ensureChat($)

    if (await read($, isDismissed)) {
      await update($, isDismissed, () => false)
      await save($)
      await $.ui.open({ id: PANE, title: 'Checklist' })

      return { text: 'Painel aberto.' }
    }

    await update($, isDismissed, () => true)
    await save($)
    await $.ui.close({ id: PANE })

    return { text: 'Painel fechado.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, isDismissed, () => true)
      await save($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, items)
    const asks = await read($, attention)
    const log = await read($, decisions)
    const alertOn = await read($, isAlertOn)
    const showDecisions = await read($, isShowingDecisions)
    const showResolved = await read($, isShowingResolved)
    const open = asks.filter(one => !one.isResolved)
    const resolved = asks.filter(one => one.isResolved)
    const done = list.filter(one => one.status === 'done').length
    const BAR = 12
    const filled = list.length === 0 ? 0 : Math.round((done / list.length) * BAR)

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {asks.length > 0 && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={open.length > 0 ? 'yellow' : undefined}
            paddingX={1}
          >
            <Text bold color={open.length > 0 ? 'yellow' : undefined} dimColor={open.length === 0}>
              {open.length > 0 ? '⚠ ' : ''}PENDÊNCIAS · {open.length}
            </Text>
            {open.length === 0 && <Text dimColor>Nenhuma pendência aberta.</Text>}
            {open.map(one => (
              <Box flexDirection="row" gap={1}>
                <Text bold color="yellow">
                  ●
                </Text>
                <Box flexShrink={1} flexGrow={1}>
                  <Text bold>{one.text}</Text>
                </Box>
                <Button
                  key={'resolve-' + one.id}
                  plain
                  dimColor
                  label="✕"
                  onPress={async () => {
                    await update($, attention, list =>
                      list.map(item => (item.id === one.id ? { ...item, isResolved: true } : item)),
                    )
                    await save($)
                  }}
                />
              </Box>
            ))}
            {resolved.length > 0 && (
              <Box flexDirection="column">
                <Button
                  key="resolved"
                  plain
                  dimColor
                  label={`${showResolved ? '▾' : '▸'} ${resolved.length} pendência(s) resolvida(s)`}
                  onPress={() => update($, isShowingResolved, isOn => !isOn)}
                />
                {showResolved &&
                  resolved.map(one => (
                    <Box flexDirection="row" gap={1}>
                      <Text color="green" dimColor>
                        ✓
                      </Text>
                      <Box flexShrink={1}>
                        <Text dimColor>{one.text}</Text>
                      </Box>
                    </Box>
                  ))}
              </Box>
            )}
          </Box>
        )}

        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>CHECKLIST</Text>
            {list.length > 0 && (
              <Text>
                <Text color="green">{'█'.repeat(filled)}</Text>
                <Text color="gray">{'█'.repeat(BAR - filled)}</Text> {done}/{list.length}
              </Text>
            )}
          </Box>
          {list.length === 0 && <Text dimColor>Nada por aqui ainda.</Text>}
          {list.map(one => (
            <Box flexDirection="row" gap={1}>
              <Text
                bold={one.status !== 'todo'}
                color={one.status === 'done' ? 'green' : one.status === 'doing' ? 'cyan' : undefined}
                dimColor={one.status === 'todo'}
              >
                {one.status === 'done' ? '✓' : one.status === 'doing' ? '▶' : '○'}
              </Text>
              <Box flexShrink={1}>
                {one.status === 'done' ? (
                  <Text dimColor strikethrough>
                    {one.text}
                  </Text>
                ) : (
                  <Text bold={one.status === 'doing'} color={one.status === 'doing' ? 'cyan' : undefined}>
                    {one.text}
                  </Text>
                )}
              </Box>
            </Box>
          ))}
        </Box>

        {showDecisions && (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Text bold dimColor>
              DECISÕES · {log.length}
            </Text>
            {log.length === 0 && <Text dimColor>Nenhuma registrada.</Text>}
            {log.map(one => (
              <Box flexDirection="row" gap={1}>
                <Text dimColor>•</Text>
                <Box flexShrink={1}>
                  <Text>{one.text}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="row" gap={2}>
          <Button
            key="alert"
            plain
            dimColor
            label={alertOn ? '🔔 Avisos: ligados' : '🔕 Avisos: desligados'}
            onPress={async () => {
              await update($, isAlertOn, isOn => !isOn)
              await savePrefs($)
            }}
          />
          <Button
            key="decisions"
            plain
            dimColor
            label={showDecisions ? 'Decisões: visíveis' : 'Decisões: ocultas'}
            onPress={async () => {
              await update($, isShowingDecisions, isOn => !isOn)
              await savePrefs($)
            }}
          />
        </Box>
      </Box>
    )
  })
}
