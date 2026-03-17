# Backend Sync & Offline-First Roadmap

This document outlines the architecture, technology stack options, and implementation steps for adding a Node.js backend service to Jimbro. The goal is to provide a multi-user, offline-first experience where workout data is synced seamlessly without data loss, using WebAuthn (Passkeys) for passwordless authentication.

## 1. Technology Stack Options

### Node.js Web Framework

*   **Express.js**
    *   **Pros:** Massive ecosystem, heavily documented, familiar to almost every Node developer, vast array of middleware.
    *   **Cons:** Older API (callback-based middleware under the hood, though easily adapted to async/await), slower performance compared to modern alternatives, no built-in validation or typing.
*   **Fastify**
    *   **Pros:** Extremely fast, built-in schema validation (JSON Schema), excellent TypeScript support, modern async/await architecture.
    *   **Cons:** Smaller ecosystem than Express, slightly steeper learning curve for its plugin architecture.
    *   **Recommendation:** **Fastify** is highly recommended for a new TypeScript-based project due to its performance and out-of-the-box validation features.

### Database

*   **SQLite (e.g., via `better-sqlite3` or Turso/libsql)**
    *   **Pros:** Zero-configuration, serverless, single-file database, incredibly fast for read-heavy or light-write workloads, very easy to back up.
    *   **Cons:** Limited concurrency for writes (though WAL mode helps significantly), scaling horizontally is complex (unless using something like Turso).
*   **PostgreSQL**
    *   **Pros:** Rock-solid reliability, excellent concurrency, powerful JSONB querying capabilities, highly scalable.
    *   **Cons:** Requires running a separate database server (or using a managed service), more overhead to set up and maintain.
    *   **Recommendation:** If you want to keep the deployment simple and cost-effective (like a single VPS), **SQLite** is perfect. If you plan for a large user base or complex analytical queries, choose **PostgreSQL**.

### ORM / Query Builder

*   **Drizzle ORM** or **Kysely**: Both offer excellent, type-safe SQL query building without the heavy abstractions of traditional ORMs like Prisma or TypeORM.

---

## 2. Authentication: WebAuthn (Passkeys Only)

To provide a secure, frictionless login experience without passwords, the backend will exclusively use Passkeys via the Web Authentication API (WebAuthn).

### Library Recommendation

Use **`@simplewebauthn/server`** for the Node.js backend and **`@simplewebauthn/browser`** for the vanilla TypeScript frontend. It handles the complex cryptography and validation required by the WebAuthn spec.

### Implementation Steps

1.  **Database Tables for Auth:**
    *   `users`: `id` (UUID), `username` (or email, for display/identification), `currentChallenge` (temporary string for login/registration).
    *   `passkeys`: `id` (credential ID), `userId`, `publicKey` (binary/base64), `counter` (integer, for replay attack prevention), `deviceType`, `backedUp`.
2.  **Registration Flow:**
    *   **Frontend:** Prompts user for a username. Calls `POST /auth/register/generate-options`.
    *   **Backend:** Generates a challenge using `generateRegistrationOptions()`. Saves the challenge temporarily to the user record.
    *   **Frontend:** Passes options to `startRegistration()` (browser API). User interacts with their device authenticator (FaceID, TouchID, YubiKey).
    *   **Frontend:** Sends the resulting assertion to `POST /auth/register/verify`.
    *   **Backend:** Verifies the assertion using `verifyRegistrationResponse()`. If successful, saves the new Passkey to the database linked to the user.
3.  **Login Flow:**
    *   **Frontend:** Calls `POST /auth/login/generate-options` (can optionally pass a username, or use discoverable credentials).
    *   **Backend:** Generates a challenge using `generateAuthenticationOptions()`.
    *   **Frontend:** Passes options to `startAuthentication()`. User authenticates.
    *   **Frontend:** Sends the assertion to `POST /auth/login/verify`.
    *   **Backend:** Verifies the assertion using `verifyAuthenticationResponse()`. Checks the signature against the stored public key and validates the `counter`.
    *   **Session Management:** Upon successful verification, issue an HTTP-only, Secure cookie containing a session token (e.g., JWT or opaque session ID).

---

## 3. Data Sync Architecture: Offline-First

The core principle is **Last-Write-Wins (LWW)** at the record level, based on an `updatedAt` timestamp.

### Client-Side Preparation (IndexedDB)

Before syncing can work, the client database must track when records are created, modified, or deleted.

1.  **Schema Migration (IndexedDB v5):**
    *   Add `updatedAt` (ISO 8601 string or Unix timestamp) to *all* records in `exercises`, `programs`, and `workoutSessions`.
    *   Add a `deleted` boolean flag (or `deletedAt` timestamp) to support soft-deletes. *Do not permanently delete records from IndexedDB; otherwise, the server won't know they were deleted.*
2.  **Tracking Changes:**
    *   Every time the frontend creates or updates a record, it must update the `updatedAt` field to `Date.now()`.
    *   Every time the frontend "deletes" a record, it sets `deleted: true` and updates `updatedAt`.
3.  **Sync State Store:**
    *   Create a new IndexedDB store (e.g., `syncMetadata`) to keep track of the `lastSyncTimestamp` (the exact server time of the last successful sync).

### Backend Database Schema

The backend tables must mirror the client's structure but include the `userId`.

*   `exercises`: `id`, `userId`, `data` (JSON/JSONB of the exercise), `updatedAt`, `deleted`.
*   `programs`: `id`, `userId`, `data` (JSON/JSONB of the program), `updatedAt`, `deleted`.
*   `workoutSessions`: `id`, `userId`, `data` (JSON/JSONB of the session), `updatedAt`, `deleted`.

### The Sync Algorithm (Pull, then Push)

Sync should be triggered automatically when the app loads (if online), when the device comes back online (`window.addEventListener('online')`), and periodically in the background or after significant user actions.

**Step 1: PULL (Get server changes)**

1.  **Client:** Sends `GET /sync?since=<lastSyncTimestamp>`.
2.  **Server:** Queries all tables for records belonging to the authenticated user where `updatedAt > since`. Returns arrays of `exercises`, `programs`, and `workoutSessions`, plus the current server timestamp (`serverTime`).
3.  **Client:**
    *   Iterates through the received server records.
    *   For each record, compares it against the local IndexedDB version.
    *   **Conflict Resolution (LWW):**
        *   If the local record does not exist, insert the server record.
        *   If the server record's `updatedAt` > local record's `updatedAt`, overwrite the local record with the server record.
        *   If the local record's `updatedAt` > server record's `updatedAt`, keep the local record (it will be pushed in Step 2).

**Step 2: PUSH (Send local changes)**

1.  **Client:** Queries IndexedDB for all records where `updatedAt > lastSyncTimestamp` (these are local changes made while offline or not yet synced).
2.  **Client:** Sends a `POST /sync` request containing these modified/new/soft-deleted records.
3.  **Server:**
    *   Receives the batch.
    *   For each record, checks the database.
    *   **Conflict Resolution (LWW):**
        *   If the client record's `updatedAt` > server record's `updatedAt` (or record doesn't exist on server), update/insert the server record.
        *   If the server's version is newer (rare, if Pull was done immediately before), reject that specific record update (or simply let the next Pull fix the client).
4.  **Client:** Upon a successful 200 OK from the Push request, updates the local `lastSyncTimestamp` to the `serverTime` received during the Pull phase.

---

## 4. Implementation Phasing Plan

### Phase 1: Client-Side Groundwork
1.  Implement IndexedDB migration to add `updatedAt` and `deleted` flags to all entities.
2.  Update all UI interactions (save, edit, delete) to properly manage these fields instead of hard-deleting.
3.  Ensure the UI filters out `deleted: true` items from lists.

### Phase 2: Backend Setup & Authentication
1.  Initialize the Node.js project (Fastify + SQLite).
2.  Set up the database schema for users and passkeys.
3.  Implement the `@simplewebauthn/server` registration and login endpoints.
4.  Create a basic frontend UI on the `/settings/` page to register a Passkey and log in.

### Phase 3: The Sync Engine
1.  Set up the backend schema for user data (exercises, programs, sessions).
2.  Implement the `GET /sync` (Pull) and `POST /sync` (Push) endpoints.
3.  Implement the frontend sync logic (`syncWithServer()`) combining the Pull and Push steps.
4.  Add robust error handling for network failures (exponential backoff for retries).

### Phase 4: Refinement
1.  Add visual sync indicators to the UI (e.g., a "Syncing..." spinner or "Offline" badge).
2.  Ensure background sync runs cleanly without interrupting the user's active gym session.
3.  Test edge cases: wiping browser data and doing a full initial pull, creating conflicts on two different devices simultaneously, and restoring from a soft-deleted state.
