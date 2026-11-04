# pi-pr-review design

## Goal

Review a pull request faster by looking at intent, structure and architecture, not by reading every line. The agent does the reading. The reviewer sees visual summaries and makes the calls.

## Principles

- Visual first. Every phase shows a rendered component, not a wall of text.
- The reviewer thinks first. In interactive steps the reviewer answers before the agent's view appears (predict, then reveal).
- Least code. No adapters or config. The agent gets the spec by asking the user. The user's own pi setup (for example a Jira MCP server) fetches tickets.
- Nothing is posted to GitHub without explicit confirmation.

## Flow

`/pr-review [pr-number-or-url]` starts a review. The extension resolves the PR with `gh` and sends the agent its instructions. The agent then works through the phases in order, using one tool per phase.

| Phase         | Tool                           | Shows                                                                                                                                                                        | Exit                                         |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0 Triage      | `pr_triage`                    | Size bar (warns over 400 changed lines), hunks split into tidying and behaviour, risk hotspots                                                                               | Reviewer acknowledges                        |
| 1 Why         | `pr_why`                       | The why, the source ticket, gaps between ticket and diff, numbered acceptance criteria                                                                                       | Reviewer confirms why and AC list            |
| 2 AC matrix   | `pr_ac_matrix`                 | One row per AC: covering tests, why they cover it, or a gap. ACs only, no rows for extra tests                                                                               | Every AC covered, or every gap has a comment |
| 3 Interfaces  | `pr_interfaces`                | Changed public interfaces, types and dependencies, grouped as names, boundaries and dependencies. Interactive: reviewer judges each flagged item, then sees the agent's view | Every flagged item answered                  |
| 4 Walkthrough | `pr_diagram`, `pr_walkthrough` | Diagram of the changed parts. Then a stepper over stops in reading order (entry, core, edges), each showing its diff hunk, the agent's summary and one focused question      | Every behaviour hunk visited                 |
| Wrap-up       | `pr_submit`                    | All draft comments. Reviewer edits, drops, picks a verdict, confirms. The extension posts one GitHub review with inline comments                                             | Posted or cancelled                          |

`pr_comment` adds a draft comment (file, line, body, blocking) at any time.

## Persistent UI

- A widget above the editor shows the phases with check marks, the current phase and the draft comment count.
- State lives in session entries (`pi.appendEntry`) and is rebuilt from `getBranch()` on session start, so a review can be paused and resumed.

## Out of scope for v1

- Linting, formatting, static analysis.
- Spec adapters (Jira, Linear, ...). The agent asks the user.
- Reviews of local branches without a PR.
