# Stats

Stats is `/stats/`: lifetime totals worked out from completed workouts.

## Sub-features

- `stats-since` shows `Active since` with the first workout's date and how long ago it was.
- `stats-totals` shows days active, workouts (with `+N incomplete` when any are unfinished), exercises, total sets, total reps, total volume and average workouts per week.

## How to get to it (user POV)

- Choose `Stats` in the bottom nav.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stop.** `15-stats`, after the tour imports a year of history.
- **By hand.** On a fresh or seeded database every number reads 0. Start a workout and the workouts tile shows `+1 incomplete`. Totals change only when a workout is completed.

## Gotchas

- Stats render once on load. Reload after a change.
- Seeding adds no workouts, so numbers stay 0 until a workout completes or history is imported.
- `Active since` depends on the time zone. The specs use America/New_York, the tour Europe/Athens.
