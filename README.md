# Jimbro - Gym Workout Tracking App

<img src="./public/icons/logo-192.png" width="100" alt="Jimbro logo" />

Personal workout tracking PWA for tracking gym workouts with a 3-day split program, logging sets/reps/weight, and visualizing progressive overload over time.

After more than a decade in web dev, I am suffering from framework fatigue. This project is an experiment and challenge for myself to build an app using only what the browser, HTML, and CSS can provide me (with the exception of TypeScript. I still want TypeScript. Oh, and Tailwind because I haven't tried that out yet).

- No routing, simple index.html files
- No frameworks. Just JavaScript (well, TypeScript).
- No dependencies (except Tailwind)

## Tech Stack

- **TypeScript** (strict mode, ES2022 target)
- **Tailwind CSS v4** via `@tailwindcss/vite`
- **Vite** (rolldown-vite) as build tool
- **IndexedDB** for client-side persistence
- No frontend framework — vanilla DOM APIs, Custom Events, static singleton classes

## Pages

| Route         | Purpose                                                     |
| ------------- | ----------------------------------------------------------- |
| `/`           | Home page with install prompt and "Start workout" CTA       |
| `/exercises/` | Exercise library — browse, create, edit, delete exercises   |
| `/programs/`  | Program management — create programs from exercises         |
| `/workouts/`  | Weekly workout calendar — view history, start new workouts  |
| `/gymtime/`   | Active workout tracking — log sets, break timer, completion |
| `/settings/`  | Data management — export, import, reset database            |

## Data Model

- **Exercise**: id, name, muscle group, target sets, target reps, soft-delete flag
- **Program**: id, name, ordered list of exercise IDs, soft-delete flag
- **WorkoutSession**: id (UUID), date, programId, exercises (with logged sets), location, status, notes
- **ExerciseExecution**: exerciseId, array of completed sets
- **ExerciseSetExecution**: reps, weight
- **WorkoutSessionStatus**: `completed` | `skipped` | `incomplete` | `pending`
- **MuscleGroups**: Quads, Calves, Hamstrings, Glutes, Chest, Biceps, Triceps, Shoulders, Traps, Back, Core

## Features

### Home Page (`/`)

- "Hey, gymbro." header with settings link
- "Start workout" button navigates to `/workouts/`
- PWA install button (shows native install prompt or iOS "Add to Home Screen" instructions)
- Install button hidden after app is installed or in standalone mode

### Exercises Page (`/exercises/`)

- Grid of exercise cards showing name, muscle group, sets × reps
- Muscle group filter dropdown (All + each muscle group)
- "New" button opens exercise dialog for creation
- Clicking an exercise card opens exercise dialog for editing
- Exercise dialog: name input, muscle group select, sets input, reps input
- Soft-delete with confirmation dialog
- List re-renders reactively when exercises are created/edited/deleted

### Programs Page (`/programs/`)

- Grid of program cards with expandable exercise lists
- "New" button opens program dialog for creation
- Edit button (pencil icon) on each program opens program dialog for editing
- Program dialog:
  - Name input
  - Multi-select exercises grouped by muscle group
  - Drag-and-drop sortable list to reorder selected exercises
- Soft-delete with confirmation dialog
- List re-renders reactively when programs are created/edited/deleted

### Workouts Page (`/workouts/`)

- Weekly calendar view, newest week first
- Each week shows up to 3 workout slots (one per program, `WORKOUTS_PER_WEEK = 3`)
- Week format: "Week N of YYYY"
- Workout card statuses with visual indicators:
  - **Completed** (green): all exercises with all sets done
  - **Incomplete** (yellow, dashed border): some sets logged but not all
  - **Pending** (gray): workout not yet started
  - **Skipped** (red): past week slot that was never started
- Click behavior:
  - Completed/incomplete → `/gymtime/?id=<session-id>` (resume/view)
  - Pending → `/gymtime/?programId=<program-id>` (start new)
  - Skipped → no action
- "New" button opens new workout dialog:
  - Lists available programs
  - Shows status for each program (e.g., "completed this week") and last completed date
  - Clicking a program navigates to `/gymtime/?programId=<id>`
- Dynamic intro text (contextual message based on workout status)
- "Seed Database" button shown when database is empty (seeds default exercises and programs)

### Gymtime Page (`/gymtime/`)

This is the core workout tracking page.

#### URL Parameters

- `?programId=<id>` — start a new workout for that program
- `?id=<session-id>` — load an existing workout session
- Missing/invalid params → error message with "Back to workouts" link

#### Workout Session Form (collapsible `<details>`)

- Date input (defaults to today)
- Location input (auto-filled via geolocation reverse geocoding)
- Notes textarea
- Submit button text varies:
  - New session: "Save & start workout"
  - Incomplete session: "Save & continue workout"
  - Completed session: "Save"
- On submit: creates or updates session, pushes `?id=` to URL, collapses form

#### Exercise Cards

- One card per exercise in the program
- Shows exercise name, muscle group
- Expandable `<details>` to show sets
- Accordion behavior: opening one exercise closes others
- Completed sets displayed with set number, reps, weight
  - `-` shown for 0 values
  - Clicking a completed set opens edit-set dialog
- Pending sets shown with dimmed styling
- Completed exercises: green card styling, no more set input
- "Finished set" form:
  - Reps and weight inputs
  - **Prefilled** from the last set in the current session, or from the last completed session of the same program, or from exercise defaults (target reps, 0 weight)
  - Confirmation dialog if submitting 0 reps or 0 weight
- Delete exercise button (visible when details are open):
  - Confirmation dialog
  - Removes exercise from session and re-renders

#### Break Timer Dialog

- Triggers after completing a non-final set of an exercise
- Full-screen countdown starting at 2:30
- Shows sets completed (e.g., "2/4 sets done")
- Shows next exercise name (if available)
- "Skip" button closes dialog immediately
- On timer end: sends browser notification (if permission granted, requests permission if not yet asked)

#### Exercise Completion

- After completing the last set of an exercise:
  - Confetti animation with "Exercise done!" message
  - Vibration pattern: `[50, 30, 50, 30, 70]`
  - Exercise card collapses and turns green
  - No break timer triggered

#### Workout Completion

- Triggers when all exercises have all their sets completed
- Confetti animation with "Workout done!" message
- Session status set to `completed`
- Auto-exports database to JSON (backup)

#### Edit Set Dialog

- Opens when clicking a completed set
- Edit reps and weight
- Updates session and DOM in-place

#### Add Exercise During Workout

- "Add exercise" card at the bottom of the exercise list
- Opens dialog with full exercise list (same muscle filter as exercises page)
- Only works when a session exists
- Adds exercise to session, re-renders list, closes dialog

#### Delete Session

- Button visible only when a session exists
- Confirmation dialog
- Deletes session, shows toast, redirects to `/workouts/`

#### DOM State Preservation

- Scroll position preserved across re-renders
- Open exercise details preserved across re-renders

### Settings Page (`/settings/`)

- **Export to JSON**: downloads full database as `jimbro-export-YYYY-MM-DD.json`
- **Import from JSON**: file input, merges data (skips existing items by ID), handles v1 and v2 export formats, success/error toast
- **Reset Database**: confirmation dialog, deletes entire database, success toast

## PWA Features

| Feature          | Details                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Web Manifest     | `app.webmanifest` with name, icons (192, 384, 512, 1024), standalone display, screenshots         |
| Install Prompt   | Intercepts `beforeinstallprompt`, shows install button, hides after `appinstalled`                |
| iOS Install      | Shows alert with "Add to Home Screen" instructions                                                |
| Screen Wake Lock | Keeps screen on during gymtime page, re-requests on tab visibility change                         |
| Notifications    | Break timer finish notification (requests permission on first use)                                |
| Geolocation      | Reverse geocodes location for workout session (city/town via Nominatim API)                       |
| Haptic Feedback  | Short vibration (`navigator.vibrate(2)`) on buttons, links, `<summary>`, `.light-haptic` elements |
| Service Worker   | Not yet implemented                                                                               |

## UI Features

- **Toasts**: success/error/warning/info notifications, short (3s) or long (5s) duration, sequential queue, click to dismiss
- **Confetti**: canvas-based animation with text overlay for exercise/workout completion
- **Dark Theme**: custom color palette (jim-dark, jim-primary, jim-accent, etc.)
- **Mobile-First**: touch targets ≥ 44×44px, fluid typography, responsive design
- **Accessible**: semantic HTML, `prefers-reduced-motion` respected, native `<dialog>` for modals, native `<details>` for collapsible sections

## Navigation

- Bottom navigation bar on all pages except home: Home, Workouts, Exercises, Programs
- Active state based on current URL path
- Back button on all sub-pages using `window.history.back()`
- No SPA router — full page loads between routes

## Import/Export

- **Export format** (v2):
  ```json
  {
    "version": 2,
    "exportDate": "ISO string",
    "stores": {
      "exercises": [...],
      "programs": [...],
      "workoutSessions": [...]
    }
  }
  ```
- **Auto-export**: triggers on workout completion as data backup
- **Import**: merges data, skips duplicates (by ID), backward compatible with v1 (no session IDs)
- **Deduplication**: uses unfiltered storage reads to avoid conflicts with soft-deleted records

## IndexedDB Schema (v4)

| Store             | Key Path    | Indexes                                       |
| ----------------- | ----------- | --------------------------------------------- |
| `exercises`       | `id`        | —                                             |
| `programs`        | `id`        | —                                             |
| `workoutSessions` | `id` (UUID) | `date` (non-unique), `programId` (non-unique) |

## Architecture

```
src/
  db/                — Persistence layer (IndexedDB)
    baseStore.ts     — Abstract BaseStore<T> with generic CRUD
    storage.ts       — Shared Storage singleton
    stores/          — ExercisesStore, ProgramsStore, WorkoutSessionsStore
    index.ts         — db.exercises, db.programs namespace
    reactiveStore.ts — Generic ReactiveStore<T>
    migrations.ts    — IndexedDB migrations (v1–v4)
    export.ts        — JSON export (v2)
    import.ts        — JSON import (v1 + v2)
  state/             — Reactive state + actions layer
    ExercisesState   — Exercises state with optimistic updates + rollback
    ProgramsState    — Programs state with optimistic updates + rollback
    GymtimeSessionState — Session state with persist-first writes
  pages/             — UI layer (static singletons, per-item classes, procedural entry points)
  features/          — Cross-cutting: toasts, confetti, haptic feedback
  eventEmitter.ts    — EventTarget-based typed event emitter
```
