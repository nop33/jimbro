---
name: no-comments
description: Strip unneeded code comments from a diff before review. Spawns a fresh Comment Sicko agent to delete them, fixes the code surprises they hid, and offers a check for each constraint a comment claimed. Use before opening or updating a pull request.
---

# No comments

Adapted from Lauren Tan's (poteto) [`/no-comments`](https://github.com/cursor/plugins/tree/main/pstack/skills/no-comments) in [pstack](https://github.com/cursor/plugins/tree/main/pstack), MIT licensed (`LICENSE` beside this file). This copy loads in Cursor from `.cursor/skills/no-comments/` and in Claude Code through the `.claude/skills/no-comments` symlink, and swaps pstack's `/why`, `/architect` and poteto-mode steps for this repository's own.

Comments need their own pass, and not from the agent that wrote them: an author defends its comments. So spawn Comment Sicko, a fresh agent with a short keep list, act on what it finds, and defer to its fresh perspective.

## Scope

Use the caller's files or diff. Otherwise use the current diff against `origin/main`, including the working tree. Never widen past it: comments outside the scope stay.

## Steps

1. Spawn a fresh agent that may edit files (Claude Code `general-purpose`, Cursor a subagent), with the text of `comment-sicko.md` below its `---` as its brief, and the scope. Do not restate or soften its rules.
2. Inspect its report and its diff (`git diff`). Reject edits to anything but comments, edits outside the scope, deletions a keep-list exception protects, misstated `MUST KILL` reasons, and flags that treat kept intentional code as guilty. Reshape flags on surprises in our own code stay actionable, and their comments stay deleted. A keep survives only with proof it is about something we cannot change. Look for lint or TypeScript suppressions in scope it missed: a suppression of a rule that guards correctness or safety is a `MUST KILL`. Restore a deletion only with the exact exception and proof in scope. Before accepting a thin `IMPORTANT` or `do not remove` kill or keep, trace the symbol and read the commit or pull request that added it. If a kill is ambiguous, do not restore. If a keep is refuted or still ambiguous, delete it. Revert and rerun one rejected report with the failure named. If the second is rejected too, report it open and stop.
3. Fix trivial accepted flags directly: delete a dead path, drop a parameter, use the real API, rename a symbol so it says what the comment said. If a fix needs a new shape (an extracted function, a type, a moved responsibility), sketch it once for all the accepted flags together before writing code.
4. Implement the smallest root-cause fix in scope. Remove every named workaround. If the root cause is out of scope, land the smallest in-scope fix and report the rest open. Never bolt on a guard for the symptom.
5. A comment that claims a constraint (`do not remove`, `must run before X`, `keep in sync with Y`) is a rule without a check. Leave keeps about things we cannot change. For the rest, offer the cheapest check that fails when the rule breaks: a type, a test, a case in `tests/architecture.unit.test.ts`, or a lint rule in `vite.config.ts`, with a row in CLAUDE.md's "Rules and their checks" table. Ask the person before adding it, unless they already approved checks for this run. If approved, add the check, then delete the comment. Otherwise delete the comment and report the constraint open.
6. Run `vp check` and the typechecks, since a deleted comment can be a formatter or lint directive.
7. Report the deletion count, restored comments, reruns, any sketch, fixes, offered and added checks, constraints left without a check, and other open work.
