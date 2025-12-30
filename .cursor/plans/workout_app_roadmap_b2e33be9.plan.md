---
name: Workout App Roadmap
overview: A step-by-step roadmap for building a workout tracking app using native web technologies, focusing on modern browser features, mobile-first design, and progressive enhancement from client-side storage to backend deployment.
todos: []
---

# Workout Tr

acking App - Native Web Technologies Roadmap

## Current State

- Basic TypeScript + Vite setup with Tailwind CSS
- In-memory data structures (exercises, templates, workout sessions)
- Simple UI showing weekly workout overview
- Three workout templates: Leg day, Push day, Pull day

## Architecture Overview

```javascript
┌─────────────────────────────────────────┐
│         Presentation Layer             │
│  (HTML Templates, Web Components)       │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         Application Layer               │
│  (State Management, Event System)       │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         Data Layer                      │
│  (IndexedDB → Backend API later)         │
└─────────────────────────────────────────┘
```



## Phase 1: Foundation & Data Persistence (Week 1-2)

### 1.1 IndexedDB Setup

**Files to create/modify:**

- `src/data/storage.ts` - IndexedDB wrapper with modern async/await API
- `src/data/migrations.ts` - Database schema versioning

**Modern features to learn:**

- IndexedDB API (async/await pattern)
- IDBRequest → Promise conversion
- Database versioning and migrations
- Transaction management

**Implementation:**

- Create IndexedDB database "gymbro-db"
- Store exercises, templates, and workout sessions
- Implement CRUD operations with proper error handling
- Add data migration system for schema changes

### 1.2 Replace In-Memory Data

**Files to modify:**

- `src/data/db.ts` - Replace hardcoded arrays with IndexedDB calls
- `src/data/exercises.ts` - Add IndexedDB persistence
- `src/data/templates.ts` - Add IndexedDB persistence
- `src/data/workoutSessions.ts` - Add IndexedDB persistence

**Implementation:**

- Migrate existing hardcoded data to IndexedDB on first load
- Update all data access functions to use IndexedDB
- Add loading states and error handling

### 1.3 Basic State Management

**Files to create:**

- `src/state/store.ts` - Simple event-driven state management
- `src/state/events.ts` - Custom event types

**Modern features to learn:**

- Custom Events API
- Event-driven architecture
- Observer pattern without frameworks

**Implementation:**

- Create a simple store that emits custom events on data changes
- Components subscribe to events for reactive updates
- No framework dependencies, pure DOM events

## Phase 2: Core Features - Workout Logging (Week 2-3)

### 2.1 Workout Session Creation UI

**Files to create:**

- `workout-log/index.html` - New page for logging workouts
- `src/workout-log.ts` - Workout logging logic

**Modern features to learn:**

- `<dialog>` element for modals
- FormData API for form handling
- Native form validation
- CSS `:has()` selector for conditional styling

**Implementation:**

- Create form to start a new workout session
- Select template, set date, location
- Use native `<dialog>` for confirmations
- Mobile-first form design with proper input types

### 2.2 Exercise Logging Interface

**Files to modify:**

- `src/workout-log.ts` - Add exercise logging UI
- `workout-log/index.html` - Exercise input forms

**Modern features to learn:**

- Web Components (Custom Elements) for reusable exercise set inputs
- CSS Container Queries for responsive components
- `<details>` and `<summary>` for collapsible sections
- Touch-friendly number inputs

**Implementation:**

- Create `<exercise-set-input>` custom element
- Use container queries for responsive set cards
- Add/remove sets dynamically
- Real-time calculation of total volume

### 2.3 Save & Complete Workout

**Files to modify:**

- `src/workout-log.ts` - Save workout to IndexedDB
- `src/data/workoutSessions.ts` - Add create/update functions

**Implementation:**

- Save workout session with all exercises and sets
- Update workout status (incomplete → completed)
- Navigate back to workouts list
- Show success feedback

## Phase 3: Data Management UI (Week 3-4)

### 3.1 Exercise Management

**Files to create:**

- `exercises/index.html` - Exercise list and management
- `src/exercises.ts` - Exercise CRUD operations

**Modern features to learn:**

- CSS Grid for responsive card layouts
- Intersection Observer API for lazy loading
- Native drag-and-drop API (optional, for reordering)

**Implementation:**

- List all exercises with muscle group filters
- Add/edit/delete exercises
- Use CSS Grid with auto-fit for responsive cards
- Filter by muscle group using native `<select>` or custom filter UI

### 3.2 Template Management

**Files to create:**

- `templates/index.html` - Template management
- `src/templates.ts` - Template CRUD operations

**Modern features to learn:**

- CSS Custom Properties for theming
- CSS Nesting (if supported)
- Multi-select interfaces

**Implementation:**

- Create/edit/delete workout templates
- Drag-and-drop or multi-select to add exercises to templates
- Preview template exercises

### 3.3 Workout History & Details

**Files to modify:**

- `workouts/index.html` - Enhanced workout list
- `src/workouts.ts` - Add workout detail view

**Modern features to learn:**

- CSS Scroll Snap for smooth scrolling
- URLSearchParams API for query strings
- History API for navigation

**Implementation:**

- Click workout card to view details
- Show all exercises, sets, reps, weights
- Edit completed workouts
- Filter by date range, template, status

## Phase 4: Enhanced UX & Mobile Optimization (Week 4-5)

### 4.1 Mobile Navigation

**Files to modify:**

- All HTML files - Add mobile navigation
- `src/navigation.ts` - Navigation component

**Modern features to learn:**

- CSS `@media` queries (advanced)
- Viewport units (vw, vh, dvw, dvh)
- Touch event handling
- CSS transitions and transforms

**Implementation:**

- Hamburger menu for mobile
- Bottom navigation bar (mobile-first)
- Smooth page transitions
- Active state management

### 4.2 Progressive Web App (PWA)

**Files to create:**

- `public/manifest.json` - PWA manifest
- `public/sw.js` - Service Worker
- `src/sw-register.ts` - Service Worker registration

**Modern features to learn:**

- Service Workers API
- Web App Manifest
- Cache API
- Background sync (optional)

**Implementation:**

- Add manifest for installability
- Service worker for offline support
- Cache static assets
- Offline-first strategy for workout logging

### 4.3 Animations & Feedback

**Files to modify:**

- `src/style.css` - Add animations
- Component files - Add loading states

**Modern features to learn:**

- Web Animations API
- CSS `@keyframes`
- `prefers-reduced-motion` media query
- CSS `will-change` property

**Implementation:**

- Loading skeletons
- Success/error toast notifications (custom, no library)
- Smooth transitions between states
- Respect user motion preferences

## Phase 5: Advanced Features (Week 5-6)

### 5.1 Statistics & Analytics

**Files to create:**

- `stats/index.html` - Statistics dashboard
- `src/stats.ts` - Calculate and display stats

**Modern features to learn:**

- Canvas API or SVG for charts (or CSS-only visualizations)
- Date manipulation with native JS
- CSS `clamp()` for fluid typography (Utopia principles)

**Implementation:**

- Volume progression over time
- One-rep max estimates
- Muscle group distribution
- Workout frequency charts
- Use CSS for simple bar charts, Canvas for complex ones

### 5.2 Search & Filtering

**Files to modify:**

- `src/workouts.ts` - Add search functionality
- `src/exercises.ts` - Add search

**Modern features to learn:**

- `input` event handling
- Debouncing with native JS
- URLSearchParams for shareable filters

**Implementation:**

- Real-time search across workouts
- Filter by multiple criteria
- Shareable filtered views via URL params

### 5.3 Data Export/Import

**Files to create:**

- `src/export.ts` - Export functionality
- `src/import.ts` - Import functionality

**Modern features to learn:**

- File API (FileReader, Blob)
- Download attribute
- JSON parsing/stringifying
- Data validation

**Implementation:**

- Export workouts to JSON
- Import from JSON
- CSV export option
- Backup/restore functionality

## Phase 6: Backend & Deployment (Week 6-7)

### 6.1 Simple Backend API

**Files to create:**

- `server/` directory structure
- `server/index.ts` - Express/Node.js server
- `server/db.ts` - Database setup (SQLite or PostgreSQL)

**Modern features to learn:**

- RESTful API design
- Fetch API for HTTP requests
- CORS handling
- Error handling patterns

**Implementation:**

- Create Express server
- REST endpoints for CRUD operations
- SQLite for simplicity (or PostgreSQL)
- Authentication (simple token-based)

### 6.2 Data Sync

**Files to modify:**

- `src/data/storage.ts` - Add sync layer
- `src/sync.ts` - Sync logic

**Modern features to learn:**

- Conflict resolution strategies
- Optimistic updates
- Background sync (Service Worker)

**Implementation:**

- Sync IndexedDB with backend
- Handle offline/online states
- Conflict resolution for concurrent edits
- Background sync when online

### 6.3 Docker Setup

**Files to create:**

- `Dockerfile` - Container definition
- `docker-compose.yml` - Multi-container setup
- `.dockerignore` - Exclude files

**Implementation:**

- Dockerize frontend build
- Dockerize backend server
- Docker Compose for full stack
- Nginx for static file serving
- Environment variable configuration

### 6.4 Deployment Configuration

**Files to create:**

- `nginx.conf` - Nginx configuration
- `deploy.sh` - Deployment script
- `.env.example` - Environment template

**Implementation:**

- Production build optimization
- Nginx reverse proxy
- SSL certificate setup (Let's Encrypt)
- Domain configuration
- CI/CD basics (optional)

## Key Modern Web Features to Master

### HTML5

- Semantic HTML (`<main>`, `<article>`, `<section>`, `<nav>`)
- `<dialog>` element
- `<details>` and `<summary>`
- Form validation attributes
- Input types (`date`, `number`, `time`)

### CSS

- CSS Custom Properties (variables)
- CSS Grid and Flexbox (advanced)
- Container Queries
- `:has()` selector
- CSS Nesting
- `clamp()`, `min()`, `max()` functions
- Viewport units (dvw, dvh)
- `@media` queries (prefers-color-scheme, prefers-reduced-motion)

### JavaScript

- ES6+ features (async/await, destructuring, modules)
- IndexedDB API
- Web Components (Custom Elements)
- Service Workers
- Fetch API
- Custom Events
- Intersection Observer
- Web Animations API
- File API
- URLSearchParams
- History API

### Mobile-First Principles

- Touch targets (minimum 44x44px)
- Responsive typography (Utopia)
- Fluid spacing (Every Layout principles)
- Container-based layouts (Cube CSS)
- Progressive enhancement

## File Structure (Final)

```javascript
gymbro/
├── src/
│   ├── data/
│   │   ├── storage.ts          # IndexedDB wrapper
│   │   ├── migrations.ts       # DB migrations
│   │   ├── exercises.ts         # Exercise data layer
│   │   ├── templates.ts         # Template data layer
│   │   ├── workoutSessions.ts   # Workout data layer
│   │   └── db.ts                # Data access layer
│   ├── state/
│   │   ├── store.ts             # State management
│   │   └── events.ts            # Event types
│   ├── components/              # Web Components
│   │   ├── exercise-set-input.ts
│   │   └── workout-card.ts
│   ├── workouts.ts              # Workouts page logic
│   ├── workout-log.ts           # Workout logging
│   ├── exercises.ts             # Exercise management
│   ├── templates.ts             # Template management
│   ├── stats.ts                 # Statistics
│   ├── sync.ts                  # Backend sync
│   ├── navigation.ts            # Navigation logic
│   ├── utils.ts                 # Utility functions
│   └── style.css                # Global styles
├── server/                       # Backend (Phase 6)
│   ├── index.ts
│   ├── db.ts
│   └── routes/
├── public/
│   ├── manifest.json            # PWA manifest
│   └── sw.js                    # Service Worker
├── workouts/
│   └── index.html
├── workout-log/
│   └── index.html
├── exercises/
│   └── index.html
├── templates/
│   └── index.html
├── stats/
│   └── index.html
├── Dockerfile
├── docker-compose.yml
└── nginx.conf
```



## Learning Resources

- [MDN Web Docs](https://developer.mozilla.org/) - Comprehensive web API documentation
- [web.dev](https://web.dev/) - Modern web best practices
- [Every Layout](https://every-layout.dev/) - Layout patterns
- [Utopia](https://utopia.fyi/) - Fluid typography and spacing
- [Cube CSS](https://cube.fyi/) - CSS methodology
- [Build Excellent Websites](https://buildexcellentwebsit.es/) - Modern web principles

## Success Metrics