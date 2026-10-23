# claude-mods

Two mods for [Claude Code](https://claude.com/claude-code) that show what Claude is doing while it works.

## agent-progress

A live **Agents** pane:

- **Header tiles:** Cost, Tokens and Time for the current prompt.
- **RUNNING · n:** a card for each running agent, with sub-agents indented under the agent that started them. Each card shows:
  - the task title, plus the agent type, model and effort
  - todo progress (`3/4 · Building pricing`), or the current step when there are no todos (thinking, writing, or the tool being called)
  - tokens, elapsed time and a progress bar
- **FINISHED · n:** compact rows marked ✓, ✗ or ■ (stopped).
- **Status line:** a one-line summary while work is running, so progress is visible even with the pane closed.

Toggle it with `/progress`.

## file-activity

A live **Files** pane:

- **RIGHT NOW:** which file Claude is reading or editing, and its folder.
- **Branch line:** the current git branch and how many files have changed.
- **File list:** every file Claude touched, grouped by folder. Each row has colored dots for *read*, *edited* and *not committed*, shows `editing…` while a change is in progress, then `+added −removed` line counts once it's done.

Toggle it with `/files`.

Only Claude's Read, Edit and Write tools are tracked. A file changed by a shell command shows just its *not committed* dot.

## Install

At the prompt of a Claude Code session:

```
/plugin install agent-progress --marketplace shakiz/claude-mods
/plugin install file-activity --marketplace shakiz/claude-mods
```

Answer `y` to add the marketplace, then choose the **user** scope so the mods load in every session.

Or from a shell:

```bash
claude plugin marketplace add shakiz/claude-mods
claude plugin install agent-progress@local-mods --scope user
claude plugin install file-activity@local-mods --scope user
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `shakiz/claude-mods`, then **Add plugin**.

The panes open on their own when the terminal is at least 144 columns wide. In a narrower terminal, open them with `/progress` and `/files`.

## Update

```bash
claude plugin marketplace update local-mods
claude plugin update agent-progress@local-mods
claude plugin update file-activity@local-mods
```

Then run `/reload-plugins` in any open session.

## Uninstall

```bash
claude plugin uninstall agent-progress@local-mods
claude plugin uninstall file-activity@local-mods
claude plugin marketplace remove local-mods
```
