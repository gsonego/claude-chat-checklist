# chat-checklist

A mod for Claude Code that shows, in a side panel, where **each chat** stands: what has to be done, what depends on you, and what was decided. No more scrolling the conversation to find out what is left.

## What the panel shows

- **Pending**: what only you can do or decide. A ✕ next to each item dismisses it. Resolved items stay collapsed in a single line ("▸ 4 resolved") that you click to see which ones they were.
- **Checklist**: the steps of the work, with a progress bar. Done (✓), in progress (▶) and to do (○).
- **Decisions**: what was agreed in the chat. Hidden by default; the "Decisions" button shows it.

Every chat has its own list, never mixed with other chats of the same project, and the list comes back when you resume the chat. Claude keeps the list up to date through a tool the mod provides as the work moves forward; the panel is read-only (except for the ✕).

When a new pending item shows up, the mod raises a toast and a notification. The "Alerts" button in the panel turns that on and off.

### Language

The repository and the defaults are in English, but the panel speaks the language of the chat: Claude is instructed to pass a translation of the interface texts (section titles, buttons, messages) the first time it uses the panel in a chat that is not in English, and the translation is stored with that chat. Items, pending entries and decisions are written by Claude in the language you write in.

### Band above the prompt

A thin line above the prompt always shows the current step, the progress and the number of open pending items, for example `▶ Write the tests · 3/7 · ⚠ pending: 1`. The ⧉ button opens and closes the panel, and the "Band" button in the panel (or `/checklist band`) turns the band on and off.

## Install

In the terminal, inside Claude Code:

```
/plugin install chat-checklist --marketplace gsonego/claude-chat-checklist
```

From a shell:

```
claude plugin install chat-checklist --marketplace gsonego/claude-chat-checklist
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `gsonego/claude-chat-checklist`, then **Add plugin**.

## Usage

- The panel opens by itself when the first item appears in a chat.
- `/checklist` opens and closes the panel. If you close it, it does not reopen by itself in that chat. `/checklist band` shows or hides the band above the prompt.
- You do not have to ask for anything: Claude starts maintaining the panel when the work has more than one step.

## Limits

- Tested in the desktop app. In the terminal the panel uses the same elements but has not been tested there; on narrow screens it only opens with `/checklist`.
- It does not play a sound: the engine has no audio player on Windows. Toast and notification work.
- The list only exists if Claude uses the mod's tool. It is encouraged by an instruction added to the system prompt, which does not run in installs under an organization's managed settings.

## Development

```
claude plugin validate .
claude plugin test .
```

The code is in `hooks/register.tsx` and the state contract in `types/index.d.ts`. The Claude Code mod API is early access and may change between releases.

## License

MIT
