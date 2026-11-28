---
name: maintain-verify-jimbro
description: Weekly pass that keeps the verify-jimbro skill and its feature map honest, with one read-only reader per feature file, one live tour, and at most one PR of proven corrections. Use for /maintain-verify-jimbro or "audit the verify skill".
disable-model-invocation: true
---

# Maintain verify-jimbro

Adapted for Jimbro from pstack's `maintain-verification-skill` by Lauren Tan (MIT License, Copyright (c) 2026 Lauren Tan, https://github.com/cursor/plugins/tree/main/pstack).

A feature map goes stale as soon as the app changes. Each UI pull request updates the stops and feature files it touches, as CLAUDE.md asks. This pass catches what those pull requests missed: a screen no stop shows, a feature file that describes old behaviour, a stop numbered wrong, or a harness step that no longer works. A scheduled run does it once a week. Run it by hand too after a large UI change.

This skill tells you to start subagents, so step 2 does not need the user to ask for them.

The target is `.cursor/skills/verify-jimbro/`, which `.claude/skills/verify-jimbro` links to. Read its `SKILL.md` and `features/README.md` before you start.

## Outcomes

The run ends in one of these. Say which one:

- **clean**: every feature file was read against the source and every feature was driven live, and nothing needs fixing. No branch, no PR.
- **changed**: one PR ships proven corrections to the skill.
- **blocked**: the pass could not finish, or a proven fix could not ship safely. Say exactly what blocked it.

## Edit scope

Edit only `.cursor/skills/verify-jimbro/` (its `SKILL.md`, `features/` and `scripts/`) and `tests/verifySkill.unit.test.ts`. Never edit product code during a run. When the map describes something the app no longer does, decide which it is. Doc drift: the app changed on purpose, so fix the map. Product regression: the app broke, so report it and leave the map alone.

## Pass

1. **Index hygiene.** Check that `features/README.md` lists every feature file once, with a one-line summary that still matches the file, and that each file follows the README's feature entry contract. Run `vp test run tests/verifySkill.unit.test.ts`. It fails when a feature file names a stop with the wrong number, names a stop the tour lacks, or leaves a stop unnamed.

2. **Source wave.** Start one read-only subagent per feature file, all at once. Give each its feature file, `features/README.md`, the page's `index.html` and `src/pages/<route>/`, the partials and `src/features/` modules the page uses, and the specs for that page in `tests/`. Each one explains how the feature works for the user, from the source. It flags likely drift, citing file and line. It returns one short recipe for checking the feature live. Subagents never run the app and never edit files. Return shape: summary / source entry points / likely drift or none / live recipe.

3. **Reconcile.** Check that every feature file got a summary. Merge overlapping recipes so the live pass needs as few app states as possible. Spot-check each cited drift in the source, and don't re-prove claims that came back clean. Then sweep recent changes for screens, sheets or states the map lacks: `git log --since='8 days ago' --name-only -- '*.html' src/pages src/features partials src/style.css`. Call something missing only when you can point to the source path that adds it.

4. **Live pass.** Required even when the source looks clean. You do all the driving yourself, on one instance:
   - `.cursor/skills/verify-jimbro/scripts/control-jimbro launch`, then `doctor`. Run `doctor` again after any failed drive or anything surprising, and relaunch rather than driving an instance in an unknown state.
   - `control-jimbro tour` on both phones. Open `artifacts/tour/index.html` and look at every stop, because a stop passes as soon as its screen shows, however it looks. Compare each shot with what its feature file says.
   - For each recipe from step 3 that no stop covers, drive it by hand with Playwright against `$JIMBRO_VERIFY_URL`, following the feature file's by-hand steps.
   - A feature you can't reach counts as unreachable only when you name the missing prerequisite and the route you tried. If the map doesn't mention that prerequisite, that is drift.
   - Where Playwright's WebKit is not installed, as in Claude Code cloud sessions, the iPhone runs in Chromium. Don't claim Safari's layout was checked. CI's `tour` artifact on the next pull request shows it.
   - Proof files under `artifacts/` must survive cleanup. Finish with `control-jimbro cleanup` after the last drive, including the re-drives for fixes in step 5.

5. **Triage.** Each finding is one of three things:
   - **Doc drift**: a feature file or `SKILL.md` describes the app wrongly or leaves part of it out. Fix the text.
   - **Harness gap**: the app works but the tour can't show it, or a stop breaks. Fix `scripts/drive.mjs` or `control-jimbro`. A new screen or sheet gets a stop, and its feature file names it by number. Insert a stop where it belongs in the flow, renumber the feature files to match, and let the unit test confirm the numbers. Drive every harness fix live again before it ships.
   - **Product gap**: the app is broken. Record it for Ilias with the steps and a screenshot. It stays out of the PR.

6. **Ship or stop.** For **changed**, open one PR from the session's branch titled `Maintain verify-jimbro: <what changed>`. Re-read every changed file first. Run `vp check`, `vp run typecheck` and `vp test run tests/verifySkill.unit.test.ts`. In the description, list the drift fixed, attach the changed or added stops on both phones, and list any product gaps under their own heading. For **clean** or **blocked**, open no PR. Report the outcome, the features covered and anything unreachable in the session's final message.

Keep short run notes (features covered, unreachable prerequisites, confirmed drift, outcome) in the session's scratch directory. Don't commit them.
