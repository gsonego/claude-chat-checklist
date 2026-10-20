import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  AttentionItem,
  ChatSnapshot,
  ChecklistItem,
  ChecklistStatus,
  DecisionItem,
  Labels,
  Prefs,
} from '../types'

const PANE = 'chat-checklist'
const TOOL = 'mcp__chat-checklist__panel'
const MAX_CHATS = 60
const MAX_ROWS = 100

/** The interface texts. English by default; the model passes a translation for the chat's language. */
const DEFAULT_LABELS: Labels = {
  title: 'Checklist',
  pending: 'PENDING',
  noPending: 'No open items.',
  resolved: '{n} resolved',
  done: '{n} done',
  older: '{n} earlier',
  none: 'none',
  checklist: 'CHECKLIST',
  empty: 'Nothing here yet.',
  decisions: 'DECISIONS',
  noDecisions: 'None recorded.',
  alerts: 'Alerts',
  showDecisions: 'Decisions',
  newPending: 'New pending item: {text}',
  opened: 'Panel opened.',
  closed: 'Panel closed.',
  bandOn: 'Band shown.',
  bandOff: 'Band hidden.',
  settings: 'SETTINGS',
  band: 'Band',
}

const LABEL_KEYS = Object.keys(DEFAULT_LABELS) as (keyof Labels)[]

const chatId = atom({ plugin: 'chat-checklist', key: 'chatId' } as const, '')
const items = atom({ plugin: 'chat-checklist', key: 'items' } as const, [])
const attention = atom({ plugin: 'chat-checklist', key: 'attention' } as const, [])
const decisions = atom({ plugin: 'chat-checklist', key: 'decisions' } as const, [])
const labels = atom({ plugin: 'chat-checklist', key: 'labels' } as const, DEFAULT_LABELS)
const isBandOn = atom({ plugin: 'chat-checklist', key: 'isBandOn' } as const, true)
const isDismissed = atom({ plugin: 'chat-checklist', key: 'isDismissed' } as const, false)
const isAlertOn = atom({ plugin: 'chat-checklist', key: 'isAlertOn' } as const, true)
const isShowingResolved = atom(
  { plugin: 'chat-checklist', key: 'isShowingResolved' } as const,
  false,
)
const isShowingDone = atom({ plugin: 'chat-checklist', key: 'isShowingDone' } as const, false)
const isShowingOlder = atom({ plugin: 'chat-checklist', key: 'isShowingOlder' } as const, false)
const isShowingDecisions = atom(
  { plugin: 'chat-checklist', key: 'isShowingDecisions' } as const,
  false,
)

// The tool description reaches the model even where the system prompt section does not
// (prompt.compose hooks do not run in installs under an organization's managed settings).
const TOOL_DESCRIPTION =
  "Keeps the side panel up to date: the user sees this chat's checklist, the pending items that need them, and the decisions made. " +
  'USE IT PROACTIVELY whenever the work has more than one step, leaves anything open or needs something from the user (skip it for a trivial one-step request). ' +
  'Put the steps in "checklist" (status todo/doing/done: set "doing" when you start a step and "done" as soon as it is finished), ' +
  'what only the user can do or decide in "attention" (resolved: true once it no longer needs them; a new one raises an alert), ' +
  'and the choices settled in this chat in "decisions". Upserts by id; keep items short, in the language the user writes in. ' +
  'In a chat that is not in English, pass "labels" translated into the user\'s language on your first call. ' +
  'Do not repeat the checklist in your replies and do not mention this tool.'

const INSTRUCTIONS = `A side panel beside the conversation shows the user a live, per-chat summary of this chat: a checklist, the things only the user can do or decide, and the decisions made. Keep it current with the ${TOOL} tool.

- Use it whenever the work has more than one step, leaves anything open, or needs something from the user. Skip it for a trivial one-step request.
- checklist: the steps of what is being done in this chat. Short items (under 80 characters), in the language the user writes in, with a stable id of your choosing. Set a step to "doing" when you start it and to "done" as soon as it is finished. Add steps as they are discovered.
- attention: only what requires the user (approve, answer, provide something, run or check something themselves). Set resolved: true once it no longer needs them. These raise an alert, so keep it for things that really block or need a human.
- decisions: one line per choice the user and you settled on, so it is not lost in the scroll.
- labels: the panel's interface texts (section titles, buttons, messages) are English by default. In a chat that is not in English, pass "labels" translated into the user's language on your first call, and again if the language changes. Keep them short, keep the section titles in UPPERCASE, and keep the {n} and {text} placeholders.
- The panel is the place for this state: do not repeat the whole checklist in your replies, do not mention the tool, and make the call alongside your other work rather than narrating it.`

type PanelInput = {
  labels?: unknown
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
    labels: await read($, labels),
    updatedAt: await $.clock.now(),
  }

  await $.store.set(`chat:${await $.session.id()}`, snapshot)
}

async function savePrefs($: EngineInterface) {
  const prefs: Prefs = {
    isAlertOn: await read($, isAlertOn),
    isShowingDecisions: await read($, isShowingDecisions),
    isBandOn: await read($, isBandOn),
  }

  await $.store.set('prefs', prefs)
}

async function openIfWanted($: EngineInterface) {
  const hasRows = (await read($, items)).length + (await read($, attention)).length > 0

  if (hasRows && !(await read($, isDismissed))) {
    await $.ui.open({ id: PANE, title: (await read($, labels)).title })
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
  await update($, labels, () => ({ ...DEFAULT_LABELS, ...snapshot?.labels }))
  await openIfWanted($)
}

// Opens the panel if the person had closed it, closes it otherwise; answers the message to show.
async function togglePanel($: EngineInterface): Promise<string> {
  await ensureChat($)

  const L = await read($, labels)

  if (await read($, isDismissed)) {
    await update($, isDismissed, () => false)
    await save($)
    await $.ui.open({ id: PANE, title: L.title })

    return L.opened
  }

  await update($, isDismissed, () => true)
  await save($)
  await $.ui.close({ id: PANE })

  return L.closed
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
    await update($, isBandOn, () => prefs?.isBandOn ?? true)

    await $.command.register({
      name: 'checklist',
      description: "Opens or closes this chat's checklist panel",
    })
    await $.tool.register({
      name: 'panel',
      description:
        TOOL_DESCRIPTION,
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
          labels: {
            type: 'object',
            description:
              "Interface texts in the user's language (omit while the chat is in English). Keep {n} and {text}.",
            properties: Object.fromEntries(
              LABEL_KEYS.map(key => [
                key,
                { type: 'string', description: `English: ${DEFAULT_LABELS[key]}` },
              ]),
            ),
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
      await update($, labels, () => DEFAULT_LABELS)
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

    const input = e as unknown as PanelInput
    const wasOpen = new Set(
      (await read($, attention)).filter(one => !one.isResolved).map(one => one.id),
    )
    const removed = new Set(
      Array.isArray(input.remove) ? input.remove.map(asId).filter(Boolean) : [],
    )

    if (typeof input.labels === 'object' && input.labels !== null) {
      const given = input.labels as Record<string, unknown>
      const merged: Labels = { ...(await read($, labels)) }

      for (const key of LABEL_KEYS) {
        const text = asText(given[key])

        if (text !== undefined) {
          merged[key] = text.slice(0, 80)
        }
      }

      await update($, labels, () => merged)
    }

    if (input.reset === true) {
      await update($, items, () => [])
      await update($, attention, () => [])
      await update($, decisions, () => [])
    }

    await update($, items, list =>
      upsert<ChecklistItem, NonNullable<PanelInput['checklist']>[number]>(
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
      upsert<AttentionItem, NonNullable<PanelInput['attention']>[number]>(
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
      upsert<DecisionItem, NonNullable<PanelInput['decisions']>[number]>(
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
      const L = await read($, labels)
      const text = L.newPending.replace('{text}', fresh[0].text)
      $.ui.toast(text)
      void $.ui.notify(text, { title: L.title }).catch(() => undefined)
    }

    const done = nowItems.filter(one => one.status === 'done').length
    const summary = `Panel updated: ${done}/${nowItems.length} done, ${open.length} pending for the user.`

    return { result: summary }
  })

  on('command.run', { command: 'checklist' }, async ($, e) => {
    if (e.args.trim() === 'band') {
      await ensureChat($)
      await update($, isBandOn, isOn => !isOn)
      await savePrefs($)

      const L = await read($, labels)

      return { text: (await read($, isBandOn)) ? L.bandOn : L.bandOff }
    }

    return { text: await togglePanel($) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, isDismissed, () => true)
      await save($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, items)
    const asks = await read($, attention)

    if (e.props.hasSurvey || !(await read($, isBandOn)) || list.length + asks.length === 0) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const L = await read($, labels)
    const open = asks.filter(one => !one.isResolved)
    const done = list.filter(one => one.status === 'done').length
    const current = list.find(one => one.status === 'doing') ?? list.find(one => one.status === 'todo')
    const label = current === undefined ? undefined : current.text.length > 60 ? current.text.slice(0, 59) + '…' : current.text

    return (
      <Box flexDirection="row" gap={1}>
        {label !== undefined && (
          <Text bold color="cyan">
            ▶ {label}
          </Text>
        )}
        {label === undefined && list.length > 0 && <Text color="green">✓</Text>}
        {list.length > 0 && (
          <Text dimColor>
            · {done}/{list.length}
          </Text>
        )}
        {open.length > 0 && (
          <Text bold color="yellow">
            · ⚠ {L.pending.toLowerCase()}: {open.length}
          </Text>
        )}
        <Button
          key="panel"
          plain
          dimColor
          label="⧉"
          onPress={async () => {
            await togglePanel($)
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const L = await read($, labels)
    const list = await read($, items)
    const asks = await read($, attention)
    const log = await read($, decisions)
    const alertOn = await read($, isAlertOn)
    const showDecisions = await read($, isShowingDecisions)
    const showResolved = await read($, isShowingResolved)
    const showDone = await read($, isShowingDone)
    const showOlder = await read($, isShowingOlder)
    const bandIsOn = await read($, isBandOn)
    const open = asks.filter(one => !one.isResolved)
    const resolved = asks.filter(one => one.isResolved)
    const done = list.filter(one => one.status === 'done').length
    const BAR = 14
    const filled = list.length === 0 ? 0 : Math.round((done / list.length) * BAR)
    const percent = list.length === 0 ? 0 : Math.round((done / list.length) * 100)
    const todo = list.filter(one => one.status !== 'done')
    const shownSteps = showDone ? list : todo
    const newest = [...log].reverse()
    const shownDecisions = showOlder ? newest : newest.slice(0, 3)
    const olderCount = newest.length - 3

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {asks.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderDimColor={open.length === 0} paddingX={1}>
            <Box flexDirection="row" justifyContent="space-between">
              {open.length > 0 ? (
                <Text bold color="yellow">
                  {L.pending} · {open.length}
                </Text>
              ) : (
                <Text>
                  <Text bold dimColor>
                    {L.pending}
                  </Text>
                  <Text color="green"> ✓ {L.none}</Text>
                </Text>
              )}
              {resolved.length > 0 && (
                <Button
                  key="resolved"
                  plain
                  dimColor
                  label={`${showResolved ? '▾' : '▸'} ${L.resolved.replace('{n}', String(resolved.length))}`}
                  onPress={() => update($, isShowingResolved, isOn => !isOn)}
                />
              )}
            </Box>
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

        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{L.checklist}</Text>
            {list.length > 0 && (
              <Text dimColor>
                {done}/{list.length} · {percent}%
              </Text>
            )}
          </Box>
          {list.length > 0 && (
            <Text>
              <Text color="green">{'█'.repeat(filled)}</Text>
              <Text color="gray">{'█'.repeat(BAR - filled)}</Text>
            </Text>
          )}
          {list.length === 0 && <Text dimColor>{L.empty}</Text>}
          {shownSteps.map(one => (
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
          {done > 0 && (
            <Button
              key="done"
              plain
              dimColor
              label={`${showDone ? '▾' : '▸'} ${L.done.replace('{n}', String(done))}`}
              onPress={() => update($, isShowingDone, isOn => !isOn)}
            />
          )}
        </Box>

        {showDecisions && (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Text bold dimColor>
              {L.decisions} · {log.length}
            </Text>
            {log.length === 0 && <Text dimColor>{L.noDecisions}</Text>}
            {shownDecisions.map(one => (
              <Box flexDirection="row" gap={1}>
                <Text dimColor>•</Text>
                <Box flexShrink={1}>
                  <Text dimColor>{one.text}</Text>
                </Box>
              </Box>
            ))}
            {olderCount > 0 && (
              <Button
                key="older"
                plain
                dimColor
                label={`${showOlder ? '▾' : '▸'} ${L.older.replace('{n}', String(olderCount))}`}
                onPress={() => update($, isShowingOlder, isOn => !isOn)}
              />
            )}
          </Box>
        )}

        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Text bold dimColor>
            {L.settings}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Button
              key="alert"
              plain
              dimColor
              label={(alertOn ? '☑ ' : '☐ ') + L.alerts}
              onPress={async () => {
                await update($, isAlertOn, isOn => !isOn)
                await savePrefs($)
              }}
            />
            <Button
              key="decisions"
              plain
              dimColor
              label={(showDecisions ? '☑ ' : '☐ ') + L.showDecisions}
              onPress={async () => {
                await update($, isShowingDecisions, isOn => !isOn)
                await savePrefs($)
              }}
            />
            <Button
              key="band"
              plain
              dimColor
              label={(bandIsOn ? '☑ ' : '☐ ') + L.band}
              onPress={async () => {
                await update($, isBandOn, isOn => !isOn)
                await savePrefs($)
              }}
            />
          </Box>
        </Box>
      </Box>
    )
  })
}
