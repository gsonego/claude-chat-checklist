export type ChecklistStatus = 'todo' | 'doing' | 'done'

export type ChecklistItem = { id: string; text: string; status: ChecklistStatus }
export type AttentionItem = { id: string; text: string; isResolved: boolean }
export type DecisionItem = { id: string; text: string }

/** The interface texts of the panel; {n} and {text} are placeholders. */
export type Labels = {
  title: string
  pending: string
  noPending: string
  resolved: string
  checklist: string
  empty: string
  decisions: string
  noDecisions: string
  alertsOn: string
  alertsOff: string
  decisionsShown: string
  decisionsHidden: string
  newPending: string
  opened: string
  closed: string
  bandOn: string
  bandOff: string
  settings: string
  bandButtonOn: string
  bandButtonOff: string
}

/** What is kept on disk for one chat, under `chat:<session id>`. */
export type ChatSnapshot = {
  items: ChecklistItem[]
  attention: AttentionItem[]
  decisions: DecisionItem[]
  isDismissed: boolean
  labels?: Labels
  updatedAt: number
}

/** What is kept on disk for the person, under `prefs`: shared by every chat. */
export type Prefs = { isAlertOn: boolean; isShowingDecisions: boolean; isBandOn?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'chat-checklist': {
      chatId: string
      items: ChecklistItem[]
      attention: AttentionItem[]
      decisions: DecisionItem[]
      isDismissed: boolean
      isAlertOn: boolean
      isShowingDecisions: boolean
      isShowingResolved: boolean
      isBandOn: boolean
      labels: Labels
    }
  }
}
