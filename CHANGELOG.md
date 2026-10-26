# Changelog

## 0.6.0

- agent-tree: a **RIGHT NOW** card at the top says what Claude is doing (`Claude is editing`, `Claude is delegating`), the file or command it's on, and how the last prompt ended. While the work is ongoing, the headline shimmers. Under a divider are the main model, the sub-agent count and a legend.
- agent-tree: each card shows a status, *Thinking*, *Reading*, *Editing*, *Committing* and so on while the agent works, shimmering, then *Done*, *Committed*, *Stopped* or *Failed*, with how many files it touched and edited.
- agent-tree: Running, Finished and Timeline sit in rounded cards with an uppercase heading and a count on the right. Below 30 columns the cards drop their borders.
- agent-tree: the pane redraws four times a second while agents run, so the shimmer moves smoothly. The status line and cost keep their old pace.

## 0.5.1

- task-band: the band now shows during any running turn, not only when Claude keeps a task list, since many sessions never get one. Without a list, the pill names what Claude is doing, a lit stretch sweeps across the bar, and the elapsed time replaces the percent. The band leaves when the turn ends.
- files: a conflicting file is marked `!` instead of ⚠. Many macOS terminals draw ⚠ two cells wide while the layout counts one, so those rows spilled past the pane into the transcript.
- agent-tree and files: the panes no longer keep a minimum width of 24 columns, so a narrow pane doesn't draw past its edge. Below 32 columns agent-tree drops the agent icons, below 36 it shows Cost, Tokens and Time on one line, and below 30 it hides the timeline.

## 0.5.0

- task-band: a new band above the prompt shows the task list's title, a pixel progress bar with a `Tasks 2/4` pill, the done percent and how many agents are running. ✕ hides it until the next prompt.
- agent-tree: a new card design. Each agent is a small pixel Clawd: the main agent wears a crown, and each sub-agent gets its own hat in its own color. Cards show a status mark (spinner, ✓, ✗ or ■) and a progress bar in the agent's color, and are split by lines instead of boxes.
- agent-tree: finished agents keep their full cards under **Finished · n**, which folds away with a click.
- agent-tree: the context meter reads `ctx 62%`, keeping its warning and error colors.

## 0.4.0

- agent-tree: a TIMELINE section, shown once a sub-agent has run, draws one bar per agent on a shared time axis from the prompt's start, so you can see which agents ran in parallel.
- files: when an agent edits a file that another sub-agent edited and that agent is still running, the file is marked ⚠, a count shows under the branch line, and a toast names the two agents.

## 0.3.0

- agent-tree: each card shows a context meter, `ctx ▰▰▰▱▱ 62%`, in the warning color from 60% and the error color from 85%.
- agent-tree: an agent's color comes from its id, so it stays the same while agents start and finish.
- files: with more than one agent at work, a legend names the agents, and each file marks who edited it (◆) or only read it (◇), in the same colors as the Agent tree.

## 0.2.1

- agent-tree: the token count no longer adds cache reads, which re-counted the whole prompt on every step.
- files: `+added −removed` comes from a line diff of the file before Claude first changed it and now, instead of counting the lines in each edit. Context lines no longer count, reverted edits net out, and `replace_all` and overwriting writes are counted correctly.
- files: paths outside the repo show `~` for the home folder on any OS, not just macOS.
- files: a renamed file's original path is no longer read as an extra changed file.

## 0.2.0

- Renamed the repo to `claude-panes` and the marketplace from `local-mods` to `claude-panes`.
- Renamed `agent-progress` to `agent-tree`: the command is now `/tree` and the pane is titled "Agent tree".
- Renamed `file-activity` to `files`.
- Added an MIT license.

## 0.1.0

- First release of `agent-progress` and `file-activity`.
