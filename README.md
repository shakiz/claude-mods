# claude-panes

Two live side panes and a band above the prompt for [Claude Code](https://claude.com/claude-code) that show what Claude is doing while it works.

## agent-tree

A live **Agent tree** pane:

- **Header tiles:** Cost, Tokens and Time for the current prompt.
- **Running · n:** a card for each running agent, with sub-agents indented under the agent that started them. Each card shows:
  - a small pixel Clawd: the main agent wears a crown, and each sub-agent gets its own hat in its own color, so agents running together are easy to tell apart
  - the task title and a status mark: a spinner while it runs, then ✓, ✗ or ■ (stopped)
  - the agent type, model and effort
  - todo progress (`3/4 · Building pricing`), or the current step when there are no todos (thinking, writing, or the tool being called)
  - `ctx 62%`: how full the agent's context window is, in the warning color from 60% and the error color from 85%, near auto-compaction
  - tokens, elapsed time and a progress bar in the agent's color
- **Finished · n:** the same cards for agents that are done. Click the heading to fold them away.
- **TIMELINE:** once a sub-agent has run, one bar per agent on a shared time axis from the start of the prompt, so you can see which agents ran in parallel and which waited.
- Each agent keeps one color, and the Files pane uses the same color for it.
- **Status line:** a one-line summary while work is running, so progress is visible even with the pane closed.

Toggle it with `/tree`.

## files

A live **Files** pane:

- **RIGHT NOW:** which file Claude is reading or editing, and its folder.
- **Branch line:** the current git branch and how many files have changed.
- **File list:** every file Claude touched, grouped by folder. Each row has colored dots for *read*, *edited* and *not committed*, shows `editing…` while a change is in progress, then `+added −removed`: the lines Claude changed in that file this session, counted from a real diff.
- **Agents:** once more than one agent has touched files, a legend lists them in their Agent tree colors, and each file shows ◆ for every agent that edited it and ◇ for one that only read it.
- **Conflicts:** when an agent edits a file that another sub-agent has edited and is still running, the file is marked ⚠, a count appears under the branch line, and a toast names both agents.

Toggle it with `/files`.

Only Claude's Read, Edit and Write tools are tracked. A file changed by a shell command shows just its *not committed* dot.

## task-band

A one-line **band above the prompt** while Claude works through a task list:

```
● Launch kit  ▚▞▙▟ ▛▜▀▐ Tasks 2/4 ▌ · ▖   ▗  ·    ▘    50%  ▐▛█▜▌ ×4  ✕
```

- the start of the prompt that began the list
- a pixel bar of how much of the list is done, with a **Tasks 2/4** pill where the done part ends; the pixels shimmer while Claude is working
- the done percent, and Clawd with how many agents are running, sub-agents included
- **✕** hides the band until your next prompt

It follows the main agent's task list (TodoWrite, or TaskCreate and TaskUpdate), not the lists sub-agents keep for themselves. When a list is finished, the next prompt clears it.

## Install

At the prompt of a Claude Code session:

```
/plugin install agent-tree --marketplace shakiz/claude-panes
/plugin install files --marketplace shakiz/claude-panes
/plugin install task-band --marketplace shakiz/claude-panes
```

Answer `y` to add the marketplace, then choose the **user** scope so the panes load in every session.

Or from a shell:

```bash
claude plugin marketplace add shakiz/claude-panes
claude plugin install agent-tree@claude-panes --scope user
claude plugin install files@claude-panes --scope user
claude plugin install task-band@claude-panes --scope user
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `shakiz/claude-panes`, then **Add plugin**.

The panes open on their own when the terminal is at least 144 columns wide. In a narrower terminal, open them with `/tree` and `/files`.

## Update

```bash
claude plugin marketplace update claude-panes
claude plugin update agent-tree@claude-panes
claude plugin update files@claude-panes
claude plugin update task-band@claude-panes
```

Then run `/reload-plugins` in any open session.

## Moving from claude-mods

The repo was called `claude-mods`, the marketplace `local-mods`, and the panes `agent-progress` (`/progress`) and `file-activity`. To switch to the new names:

```bash
claude plugin uninstall agent-progress@local-mods
claude plugin uninstall file-activity@local-mods
claude plugin marketplace remove local-mods
```

Then follow [Install](#install).

## Uninstall

```bash
claude plugin uninstall agent-tree@claude-panes
claude plugin uninstall files@claude-panes
claude plugin marketplace remove claude-panes
```

## License

[MIT](LICENSE)
