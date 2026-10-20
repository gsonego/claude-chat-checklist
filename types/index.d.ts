export type ChecklistStatus = 'todo' | 'doing' | 'done'

export type ChecklistItem = { id: string; text: string; status: ChecklistStatus }
export type AttentionItem = { id: string; text: string; isResolved: boolean }
export type DecisionItem = { id: string; text: string }

/** What is kept on disk for one chat, under `chat:<session id>`. */
export type ChatSnapshot = {
  items: ChecklistItem[]
  attention: AttentionItem[]
  decisions: DecisionItem[]
  isDismissed: boolean
  updatedAt: number
}

/** What is kept on disk for the person, under `prefs`: shared by every chat. */
export type Prefs = { isAlertOn: boolean; isShowingDecisions: boolean }

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
    }
  }
}
