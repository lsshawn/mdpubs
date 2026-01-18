# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MdPubs** is a SvelteKit application for syncing and publishing markdown notes from Neovim to the cloud. Users can manage notes with version control, make them public/private, and access them via custom domains or usernames.

## Tech Stack

- **Frontend**: SvelteKit 5 + Svelte 5 (runes-based)
- **Styling**: Tailwind CSS 4 + DaisyUI
- **Database**: Turso (libSQL) with Drizzle ORM
- **Auth**: Custom session-based auth with OAuth (Google, GitHub) and OTP email login
- **Payments**: Stripe integration for subscriptions
- **Deployment**: Vercel (adapter-vercel)

## Common Commands

```bash
# Development
pnpm dev              # Start dev server (default: http://localhost:5173)
pnpm dev -- --open    # Start dev server and open browser

# Building
pnpm build            # Build for production
pnpm preview          # Preview production build

# Code Quality
pnpm check            # Type-check with svelte-check
pnpm check:watch      # Type-check in watch mode
pnpm lint             # Run ESLint and Prettier checks
pnpm format           # Format all files with Prettier

# Database (Main)
pnpm db:push          # Push schema changes to main database
pnpm db:migrate       # Run migrations for main database
pnpm db:studio        # Open Drizzle Studio for main database

# Database (Feedback)
pnpm db:feedback:push     # Push schema changes to feedback database
pnpm db:feedback:migrate  # Run migrations for feedback database
pnpm db:feedback:studio   # Open Drizzle Studio for feedback database
```

## Architecture

### Database Architecture

**Dual-Database Setup**: The app uses two separate Turso databases:
1. **Main database** (`DATABASE_URL`) - user data, notes, sessions
2. **Feedback database** (`FEEDBACK_DATABASE_URL`) - feedback submissions, projects

**Main Schema** (`src/lib/server/db/schema.ts`):
- `users` - user accounts with OAuth IDs, API keys, Stripe data, custom domains
- `sessions` - auth sessions (30-day expiry, auto-renewed at 15 days)
- `notes` - markdown notes with versioning, tags, privacy flags, image maps
- `note_versions` - historical versions of notes

**Feedback Schema** (`src/lib/server/db/feedback.schema.ts`):
- `projects` - feedback projects
- `feedback` - user feedback submissions with metadata

### Authentication System

Session-based auth using SHA-256 hashed tokens stored in HTTP-only cookies (`auth-session`).

**Auth Flows**:
- OAuth (Google/GitHub) via Arctic library
- Email OTP (one-time password) with rate limiting
- API key authentication for programmatic access (both read-write and read-only keys)

**Key Files**:
- `src/lib/server/auth.ts` - session management, token generation
- `src/lib/server/oauth.ts` - OAuth providers configuration
- `src/lib/server/otp.ts` - OTP generation and verification
- `src/hooks.server.ts` - session validation middleware + custom domain routing

### Route Structure

**SvelteKit Route Groups**:
- `(public)` - unauthenticated routes (landing page, login, public note views)
  - `/[id]` - view public note by ID
  - `/u/[username]` - view user's public notes
  - `/login` - authentication pages
  - `/api/auth/*` - public auth endpoints
- `(app)` - authenticated routes requiring login
  - `/notes` - user's note dashboard
  - `/api/notes/*` - note CRUD operations
  - `/api/account/*` - account management
  - `/api/stripe/*` - Stripe portal session creation
  - `/api/users/*` - user data and note access

### Custom Domain Handling

`src/hooks.server.ts` intercepts requests:
1. If host is NOT default (mdpubs.com/localhost), lookup user by `customDomain`
2. Redirect root `/` to `/u/[username]`
3. Rewrite all paths to `/u/[username]/[path]`

### API Key Authentication

Users have two API keys (in `users` table):
- `apiKey` - full read-write access
- `readOnlyApiKey` - read-only access

Used for programmatic note syncing from Neovim plugin.

### Server-Side Libraries

- `src/lib/server/user.ts` - user management utilities
- `src/lib/server/stripe.ts` - Stripe subscription handling
- `src/lib/server/email.ts` - Mailgun email sending
- `src/lib/server/config.ts` - environment variable validation

## Environment Variables

Required env vars (see `.env.example`):
- `DATABASE_URL`, `DATABASE_AUTH_TOKEN` - main Turso database
- `FEEDBACK_DATABASE_URL`, `FEEDBACK_DATABASE_AUTH_TOKEN` - feedback database
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM` - email for OTP
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - payment processing
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - Google OAuth
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - GitHub OAuth
- Public vars: `PUBLIC_DOMAIN`, `PUBLIC_API_URL`, `PUBLIC_STRIPE_*_LINK`

## Key Patterns

**Type Inference**: Use Drizzle's `$inferSelect` and `$inferInsert` for type-safe DB operations.

**Route Protection**: Auth-required routes are in `(app)` group. `+layout.server.ts` at `(app)` level handles redirects for unauthenticated users.

**Locals**: `event.locals.user` and `event.locals.session` available in all routes after `hooks.server.ts` runs.

**Image Handling**: Notes can have `imageMap` (JSON field) mapping markdown image refs to URLs.
