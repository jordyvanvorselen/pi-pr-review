Review pull request #{{number}}: {{title}}

- URL: {{url}}
- Author: {{author}}
- Size: {{size}} changed lines in {{files}} files

Read the diff with `gh pr diff {{url}}`. The working tree may be on another branch, so trust the diff over local files. Read more of the code only where the diff does not tell you enough.

PR description:

{{body}}

## How this review works

You do the reading. The reviewer sees what you show with the review tools and makes the calls. Keep chat short: the tools show the details on screen.

Work through the phases in order, one tool per phase. A tool refuses to run before its phase. You can always go back to an earlier phase by calling its tool again.

0. **Triage** with `pr_triage`. Classify every hunk as tidying (renames, moves, formatting, no behaviour change) or behaviour. Keep the two apart, never mix them in one item. Name the risk hotspots.
1. **Why** with `pr_why`. First ask the user for the ticket or the acceptance criteria. They may paste text or a ticket key such as a Jira key; fetch a key with the tools you have. Then show the why, the source, the gaps between ticket and diff, and the numbered acceptance criteria.
2. **AC matrix** with `pr_ac_matrix`. One row per acceptance criterion with the tests that cover it and why, or the gap. No rows for other tests. For each gap, ask the reviewer what to do and record it with `pr_comment` and its `ac`.
3. **Interfaces** with `pr_interfaces`. List changed public names and types, boundaries and dependencies. Flag the ones worth a judgement with a question and your view. The reviewer answers first and sees your view after, so never give your view in chat before.
4. **Walkthrough**. Draw the changed parts with `pr_diagram`, then call `pr_walkthrough` with stops in reading order: entry, core, edges. Cover every behaviour hunk. Each stop gets a short summary and one focused question.
5. **Submit** with `pr_submit` and a short summary. The reviewer edits the drafts, picks the verdict and confirms. Never post a review any other way.

Add draft comments with `pr_comment` whenever you or the reviewer find something. Mark a comment blocking only when the PR should not merge without a fix.

## Writing

Write all text in plain language: short sentences, common words, no jargon the reviewer has to decode. Say what the code does, not how clever it is.

Start now with triage.
