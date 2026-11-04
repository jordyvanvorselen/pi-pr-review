# pi-pr-review

Review a pull request with [Pi](https://github.com/earendil-works/pi) by intent, structure and architecture, not by reading every line.

The agent reads the diff. You see short visual summaries and make the calls: bars, tables, badges, check marks and diagrams. Nothing goes to GitHub until you confirm it.

## Install

From git:

```bash
pi install git:github.com/jordyvanvorselen/pi-pr-review
```

From a local folder:

```bash
pi install ./pi-pr-review
```

You need the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`.

## Use

```text
/pr-review          the PR of the current branch
/pr-review 123      a PR by number
/pr-review <url>    a PR by URL
```

The agent gets its instructions and starts. It asks you for the ticket or the acceptance criteria. Paste them, or give a ticket key such as a Jira key if your Pi can fetch tickets, for example with a Jira MCP server.

A line above the editor shows the phases, the one you are in and how many draft comments there are. The review lives in the session, so you can stop and pick it up later.

## Phases

| Phase         | What you see                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------- |
| 0 Triage      | Size bar (warns over 400 changed lines), every hunk marked tidying or behaviour, risk hotspots  |
| 1 Why         | Why the PR exists, where that comes from, gaps between ticket and diff, numbered criteria       |
| 2 AC matrix   | One row per criterion with the tests that cover it, or the gap                                  |
| 3 Interfaces  | Changed names, boundaries and dependencies. You judge each flagged item before the agent's view |
| 4 Walkthrough | A diagram of the changed parts, then a stepper with the diff hunk and one question per stop     |
| Submit        | Each draft comment to keep, edit or drop, then the verdict and one GitHub review                |

The agent can add a draft comment at any time. The phases go in order. The agent can go back to an earlier phase but not skip ahead.

On the review screens: ↑/↓ or 1–9 pick, ↵ chooses, ← goes back, pgup/pgdn scroll, esc closes.

## Privacy

The agent sends the PR's code, its description and the ticket text you give it to your LLM provider, like any other Pi session. The full PR diff is saved in the Pi session file on your machine, so you can pick the review up later.

## Change the instructions

The agent's instructions are in [prompts/review.md](prompts/review.md). Edit that file to change how the agent reviews.
