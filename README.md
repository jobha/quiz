# Quiz

A tiny multiplayer quiz app for FaceTime nights. One person is the
quizmaster, everyone else joins a room with a code and answers from their
phone.

- **Free text** and **multiple choice** questions
- Real-time updates via Supabase
- Rejoin from a closed browser using the same link (player ID lives in the
  URL and `localStorage`), or by typing a 4-char rejoin code on any device
- Hosted free on Vercel + Supabase

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind v4
- Supabase Postgres + Realtime
- Deployed on Vercel

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase

1. Open the SQL editor in your Supabase project.
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. Confirm Realtime is enabled on the four tables (`rooms`, `questions`,
   `players`, `answers`) — the SQL adds them to the `supabase_realtime`
   publication automatically.

### 3. Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # publishable / anon key
SUPABASE_SERVICE_ROLE_KEY=...         # secret / service role key
```

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Push this repo to GitHub.
2. On Vercel, import the repo.
3. Add the same three env vars from `.env.local` in the project settings.
4. Deploy.

## How it works

- **Create room** — `POST /api/rooms` returns `{ code, host_secret }`. The
  host page lives at `/r/<code>/host?k=<host_secret>` — bookmark this link
  to come back. The secret is also cached in `localStorage`.
- **Join room** — Players go to `/r/<code>`, enter a name. The server
  creates a `players` row and the client stores the player id in
  `localStorage` and the URL (`?p=…`), so closing the browser is fine.
- **Asking → Revealed → Next** — Host hits "Reveal" to show the correct
  answer to everyone, then advances. Free-text answers are auto-graded with
  a loose match; the host can override with ✓/✗ during reveal.
- **Auth** — All writes go through `/api/...` routes that check the host
  secret. Reads use Supabase realtime with read-only RLS.
- **Rejoin codes** — Each player gets a short 4-char code shown in their
  header; the host gets a "host rejoin code" shown on the host page. From
  the landing page, anyone can type the room code + their personal code on
  any device to come back as themselves. The original `?p=` / `?k=` links
  still work too.

## Roadmap (easy next steps)

- Timers per question
- Image questions
- Question packs / import from CSV
- Final results screen with confetti
- Per-player avatars
