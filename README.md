# Whisker Watch 🐾

A health & wellness tracker for your cats. Works on your laptop and your phone,
with everything stored locally — no accounts, no cloud required.

## What it does

- **Home** — everything that needs attention today: doses to give, treatments due,
  upcoming vet visits, and a quick wellness-check for each cat.
- **Cats** — your list of cats with age, photo/colour tag and notes. Archive keeps
  a cat's history without cluttering the lists; delete removes everything.
- **Daily log** — one entry per cat per day: appetite (not eating → eating more),
  diet notes, wellness notes and optional weight. Browse back through any day.
  Entries (and vet visits) can have **photo & video attachments** — perfect for
  filming odd behaviour or neurological signs to show the vet. On a phone the
  add button opens the camera roll or lets you record on the spot.
- **Meds** — medications per cat with dose, 1–4 times a day and optional clock
  times. Tick doses off as you give them; the 7-day grid shows what's been given
  (you can tap a past day's square if you forgot to tick it).
- **Flea & worm** — up to 3 treatments per cat (e.g. separate flea, worming and
  other parasite products), each with its own repeat interval (monthly by default,
  editable to any number of days/weeks/months). Shows **last given** and **next
  due** for every treatment; tap **✓ Given** and the next due date rolls forward
  automatically. Cats are ordered by whoever is due first.
- **Vet** — upcoming appointments (with countdown) and past visits with outcome notes.
- **Reminders** — turn on notifications in Settings ⚙ to get a pop-up when a timed
  dose is due and a once-a-day summary of anything overdue. Because the app is
  fully local, reminders fire **while the app is open (or when you open it)** —
  opening it once a day with your morning routine works well.

## Running it

**On this computer:** double-click **`Start Whisker Watch.bat`**
(or run `node server.js`). It opens at <http://localhost:4780>.

**On your phone (same Wi-Fi):** with the server running on the laptop, the console
shows a `http://192.168.x.x:4780` address — open that on your phone and use
*Add to Home Screen* to make it feel like an app. Laptop and phone share the same
data file, so they stay in sync.

## Where the data lives

- Through the server: one JSON file at `data/cat-data.json`, with rolling backups
  in `data/backups/` on every save (last 40 kept). Photo & video attachments are
  stored as files in `data/media/` (up to 500 MB each) — copy that folder to back
  them up; they're not inside the JSON export. Attachments need the server running,
  which is the normal way you'll use the app anyway.
- Opened without the server (e.g. deployed as a static site): data stays in that
  browser's local storage.
- Either way, **Settings → Export backup** downloads a JSON file you can keep
  anywhere or import on another device (merge or replace).

## Notes

- No dependencies, no build step — plain HTML/CSS/JS plus a zero-dependency Node
  server, same pattern as Bill Tracker.
- Can be deployed to Vercel as a static site (`vercel.json` included); it then runs
  in local-only mode per device, with export/import to move data.
- Port 4780. Sample data is available under Settings if you want to poke around first.
