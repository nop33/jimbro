---
name: Progressive Workout Sessions Loading
overview: Implement progressive loading of workout sessions grouped by week using IndexedDB cursors for pagination and Intersection Observer API for scroll detection. Sessions will load in batches as the user scrolls, with newest weeks displayed first.
todos:
  - id: add-cursor-pagination
    content: Add cursor-based pagination method to Storage class (getAllPaginated) using IDBObjectStore.openCursor()
    status: pending
  - id: add-store-methods
    content: Add getWorkoutSessionsPaginated method to WorkoutSessionsReactiveStore for batch loading
    status: pending
    dependencies:
      - add-cursor-pagination
  - id: create-week-utils
    content: Create week grouping utility functions (getWeekKey, getWeekStart, groupSessionsByWeek)
    status: pending
  - id: create-week-component
    content: Create WeekComponent class to render a single week with its sessions
    status: pending
    dependencies:
      - create-week-utils
  - id: create-session-card
    content: Create WorkoutSessionCard component to render individual workout sessions
    status: pending
  - id: create-workouts-page
    content: Create main workouts page component with Intersection Observer for progressive loading
    status: pending
    dependencies:
      - add-store-methods
      - create-week-component
      - create-session-card
  - id: update-html
    content: Update workouts/index.html with dynamic structure and sentinel element
    status: pending
  - id: wire-up-page
    content: Wire up the workouts page in main.ts or navigation to initialize the component
    status: pending
    dependencies:
      - create-workouts-page
      - update-html
---

# Progressive Workout Sessions Loading

Implement progressive loading of workout sessions grouped by week, using native IndexedDB cursors for efficient pagination and Intersection Observer API for scroll detection.

## Architecture Overview

The solution uses three native web APIs:

1. **IndexedDB Cursors**: For efficient pagination without loading all data
2. **Intersection Observer API**: To detect when user scrolls near bottom
3. **Native DOM APIs**: For rendering and event handling

## Data Model Efficiency

**Current Design is Optimal**: The workout sessions object store already uses `date` (ISO string) as the primary key (see `src/db/migrations.ts` line 24). This is the most efficient design for this use case:

### Why ISO Date Strings as Primary Key Work Well

1. **Lexicographic Sorting**: ISO date strings (YYYY-MM-DD format) are lexicographically sortable:

- `"2024-12-30" < "2024-12-31" < "2025-01-01"` (correct chronological order)
- No conversion needed for sorting or range queries
- IndexedDB can efficiently index and query string keys

2. **Query Efficiency**:

- **O(1) lookups**: Direct key access by date
- **O(log n) range queries**: B-tree indexes make date range queries very fast
- **O(k) cursor pagination**: After finding start position, reading k items is linear
- **Uniqueness constraint**: Enforces "1 session per day" rule at database level

3. **Cursor Pagination Benefits**:

- Can use date string directly as cursor position: `openCursor(IDBKeyRange.upperBound(beforeDate), 'prev')`
- No need for separate indexes or complex queries
- Efficient backward pagination (newest first) using `'prev'` direction

### Performance Characteristics

- **Lookup by date**: O(1) - direct key access
- **Range query** (e.g., all sessions in a week): O(log n + k) where k is result count
- **Cursor pagination**: O(log n) to find start + O(k) to read k items
- **Memory**: Only loaded batches in memory, not entire dataset

This design scales efficiently even with thousands of workout sessions.

## Implementation Plan

### 1. Add Cursor-Based Pagination to Storage

**File**: [`src/db/storage.ts`](src/db/storage.ts)Add a new method `getAllPaginated` that uses IndexedDB cursors to fetch items in batches:

- Accepts: `storeName`, `limit`, `offset` (or `startKey` for cursor-based pagination)
- Uses `IDBObjectStore.openCursor()` with `prev` direction for descending order
- Returns array of items matching the pagination parameters
- Supports filtering by date range if needed

This method will efficiently fetch only the requested batch without loading all records.

### 2. Add Progressive Loading Methods to WorkoutSessionsStore

**File**: [`src/db/stores/workoutSessionsStore.ts`](src/db/stores/workoutSessionsStore.ts)Add methods:

- `getWorkoutSessionsPaginated(limit: number, beforeDate?: string)`: Fetches a batch of sessions ordered by date (descending), optionally starting before a specific date
- `getAllWorkoutSessionsPaginated()`: Helper that loads all sessions progressively (for initial load or full refresh)

The pagination will use the `date` field as the key, fetching in descending order (newest first).

### 3. Create Week Grouping Utilities

**File**: [`src/utils/weekGrouping.ts`](src/utils/weekGrouping.ts) (new file)Create utility functions:

- `getWeekKey(date: string)`: Returns a week identifier (e.g., "2025-W01") for grouping
- `getWeekStart(date: string)`: Returns the start date (Monday) of the week for a given date
- `groupSessionsByWeek(sessions: WorkoutSession[])`: Groups sessions into week objects with:
- `weekKey`: Unique identifier for the week
- `weekStart`: ISO date string of week start (Monday)
- `weekEnd`: ISO date string of week end (Sunday)
- `sessions`: Array of sessions in that week
- `expectedPrograms`: Array of all program IDs (to identify missing sessions)

### 4. Create Workouts Page Component

**File**: [`src/pages/workouts/index.ts`](src/pages/workouts/index.ts) (new file)Main component that:

- Initializes with first batch of sessions (e.g., 30 sessions = ~10 weeks)
- Groups sessions by week using the utility functions
- Renders weeks in descending order (newest first)
- Sets up Intersection Observer on a sentinel element at the bottom
- Loads next batch when sentinel becomes visible
- Appends new weeks to the DOM as they load

### 5. Create Week Component

**File**: [`src/pages/workouts/WeekComponent.ts`](src/pages/workouts/WeekComponent.ts) (new file)Component to render a single week:

- Displays week range (e.g., "Dec 23 - Dec 29, 2024")
- Renders all sessions in that week
- Shows visual indicators for missing sessions (sessions that should exist but don't)
- Uses semantic HTML (`<section>`, `<article>`, etc.)

### 6. Create Workout Session Card Component

**File**: [`src/pages/workouts/WorkoutSessionCard.ts`](src/pages/workouts/WorkoutSessionCard.ts) (new file)Component to render individual workout session:

- Displays program name, date, status, location
- Click handler to open detail dialog
- Uses the existing template pattern from `workouts/index.html`

### 7. Update Workouts HTML

**File**: [`workouts/index.html`](workouts/index.html)Update the HTML structure:

- Replace static week sections with a container for dynamically loaded weeks
- Add a sentinel element at the bottom for Intersection Observer
- Add loading indicator that shows while fetching next batch
- Keep existing dialog templates for workout details

### 8. Add Loading State Management

**File**: [`src/pages/workouts/index.ts`](src/pages/workouts/index.ts)Implement:

- Loading state to prevent duplicate requests
- Track the last loaded date to use as cursor position for next batch
- Handle end-of-data state (no more sessions to load)
- Error handling with user-friendly messages

## Technical Details

### IndexedDB Cursor Pagination Pattern

Since `date` is the primary key, cursor pagination is straightforward:

```typescript
// Efficient cursor-based pagination using date as key
const range = beforeDate 
  ? IDBKeyRange.upperBound(beforeDate, true) // Exclude beforeDate
  : null
const cursor = store.openCursor(range, 'prev') // Descending order (newest first)
let count = 0
const results: WorkoutSession[] = []

cursor.onsuccess = (event) => {
  const cursor = event.target.result
  if (cursor && count < limit) {
    results.push(cursor.value)
    count++
    cursor.continue()
  } else {
    resolve(results)
  }
}
```

**Key advantages**:

- Uses primary key directly (no index needed)
- `IDBKeyRange.upperBound()` efficiently positions cursor
- `'prev'` direction gives descending order (newest first)
- O(log n) to find start position, then O(k) to read k items

### Intersection Observer Setup

```typescript
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && !isLoading) {
    loadNextBatch()
  }
}, { rootMargin: '100px' }) // Start loading 100px before bottom
observer.observe(sentinelElement)
```



### Week Grouping Logic

- Use ISO week numbering or simple week start (Monday) calculation
- Group sessions where `getWeekStart(session.date)` matches
- Sort sessions within each week by date (ascending within week)

## Benefits of This Approach

1. **Native APIs**: Uses IndexedDB cursors (the idiomatic way) and Intersection Observer
2. **Memory Efficient**: Only loads visible weeks + a small buffer
3. **Performant**: Cursor-based queries are fast, even with thousands of records
4. **Progressive Enhancement**: Works without JavaScript for basic functionality
5. **Educational**: Demonstrates real-world use of native web APIs

## Why Not Streams API?

While the Streams API could work, IndexedDB cursors are:

- More appropriate for database pagination
- Simpler to implement and understand
- Better performance for IndexedDB operations