# Changelog

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
