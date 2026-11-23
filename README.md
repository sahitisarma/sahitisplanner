# Sahiti’s Planner

A personal planner for a 13-inch iPad and Apple Pencil. It combines handwriting, Google Calendar, Google Tasks, lists, notes and voice notes in one place.

There's no build step. It's plain HTML, CSS and JavaScript, so GitHub Pages can host it as-is.

---

## 1. Publish it (GitHub Pages, free)

1. Push this folder to `github.com/sahitisarma/sahitisplanner`.
2. On GitHub, open the repo, then **Settings → Pages**.
3. Under **Source**, pick **Deploy from a branch**. Choose `main` and `/ (root)`. Save.
4. Wait about a minute. Your link will be:
   **https://sahitisarma.github.io/sahitisplanner/**

> GitHub Pages is free for **public** repos. A private repo needs a paid GitHub plan for Pages. Your planner data is **not** stored in the repo either way. It lives on your devices and in your own Google Drive.

## 2. Add it to your iPad Home Screen

1. Open the link above in **Safari** on the iPad.
2. Tap **Share** (the square with an arrow).
3. Tap **Add to Home Screen**. Keep the name **Sahiti’s Planner**, then tap **Add**.
4. Open it from the new icon. It runs full screen and reopens where you left off.

## 3. Connect Google so it stays connected

Browsers only get Google access for about an hour at a time. To stay connected for good, the planner uses a tiny free helper server (a Cloudflare Worker, code in `server/worker.js`). It keeps a long-lived Google sign-in on the server and hands the planner fresh access whenever it needs it. You set it up once, and it costs nothing.

### A. Google Cloud (about 10 minutes)
1. Go to **console.cloud.google.com** and create a project (for example "Sahiti Planner").
2. **APIs & Services → Library**: enable **Google Calendar API**, **Google Tasks API** and **Google Drive API**.
3. **OAuth consent screen**: choose **External**, name it Sahiti’s Planner, and add your email.
   - Then tap **Publish app** so it's **In production**. This matters: in "Testing" mode Google signs you out every 7 days.
   - Google will show an "unverified app" warning when you connect. That's expected for a personal app. Tap **Advanced → Go to Sahiti’s Planner**.
4. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `https://sahitisarma.github.io`
   - Authorized redirect URIs: leave this for now. You'll add the server address in step B5.
   - Copy the **Client ID** and the **Client secret**.

### B. Cloudflare helper server (about 10 minutes, free)
1. Sign up at **dash.cloudflare.com**.
2. **Storage & Databases → KV → Create namespace**, named `SP_KV`.
3. **Workers & Pages → Create → Create Worker**. Name it `sahitis-planner-auth` and deploy the starter.
4. Open the worker:
   - **Edit code**: replace everything with the contents of `server/worker.js`, then **Deploy**.
   - **Settings → Bindings → Add → KV namespace**: variable name `SP_KV`, namespace `SP_KV`.
   - **Settings → Variables and Secrets**, add:
     - `APP_ORIGIN` = `https://sahitisarma.github.io`
     - `GOOGLE_CLIENT_ID` = your client ID
     - `GOOGLE_CLIENT_SECRET` = your client secret (choose type **Secret**)
5. Copy the worker's address, e.g. `https://sahitis-planner-auth.yourname.workers.dev`. In Google Cloud, add `https://sahitis-planner-auth.yourname.workers.dev/auth/callback` to **Authorized redirect URIs** and save.

### C. In the planner
1. **Settings → Google Calendar and Tasks**: paste the worker address into **Connection server**.
2. Tap **Connect Google** and approve.
3. Do this once on the iPad and once on your computer.

The settings card then says **Always connected**. While the planner is open, it checks Google for changes every 30 seconds, and again whenever you come back to it.

*No server?* Under **No server? Use a client ID instead** you can paste just a client ID. That works too, but Google access lasts about an hour and renews when you open the app.

### What syncs where

| What | Where it goes |
|---|---|
| Events | Two-way with Google Calendar. |
| Linked tasks | Two-way with Google Tasks: title, due date, done or not done. |
| Handwriting, colors, fonts, layout, lists, notes, voice notes | Saved on the device instantly, then synced between your devices through a private app-data file in your Google Drive. |

### Good to know
- **Your handwriting stays.** It's saved on the device the moment you lift the Pencil. Open the planner from the Home Screen icon (Safari can clear data for sites in a regular tab after 7 days without a visit), and don't use Private Browsing.
- **Live voice transcripts** use Safari's speech recognition. Recordings save either way.
- **Handwriting to text** only runs when you ask, and it needs a connection.

## 4. Everyday use

- **Write anywhere** with the Pencil, no mode switch needed. Fingers scroll and tap.
- The **pen dock** at the bottom has pen, highlighter, eraser, lasso, your presets, colors, undo and redo, and **quick capture** (the yellow mic).
- **Lasso** handwriting to move it, resize it, recolor it, delete it, or turn it into text.
- **To-Dos and Errands**: type in the line, or just write in the pad below it. When you pause, your handwriting becomes an item with a working checkbox.
- **Rollover**: unfinished items planned for an earlier day show up today automatically, marked ↻. It's the same item, never a copy. Turn rollover off per item with ⋯.
- **Dashboard** is the open-planner spread. Drag the spine to resize the pages, drag the bar under a panel to resize it, and use ⋯ to move or collapse panels. Your layout is remembered.
- **Status pill** (top right): Saving, Saved, Syncing, or Needs attention. Tap it for details.
- **On a computer**: ⌘Z / ⌘⇧Z undo and redo handwriting, and ⌘K opens quick capture.

## 5. Checklist to try on your iPad

The automated checks ran in a desktop browser. These need a real iPad and Pencil:

- [ ] Write in a to-do pad, close the app fully, reopen. Is the handwriting still there?
- [ ] Pencil writes, finger scrolls, and finger taps a calendar day to open it.
- [ ] Rotate the iPad. Is the handwriting still lined up with its page and items?
- [ ] Palm resting on the screen doesn't leave marks.
- [ ] Check off a linked task, then confirm it's done in Google Tasks.
- [ ] Move an event in Google Calendar, then confirm it moves in the planner.

## Updating the app

After changing files, bump `VERSION` in `sw.js` (for example `sp-v2`), then push. The iPad picks up the new version next time it opens online.

## Files

```
index.html            app page
css/app.css           the retro planner look
css/fonts.css         bundled fonts (work offline)
js/app.js             shell, routing, status pill
js/store.js           automatic saving (IndexedDB)
js/model.js           sections, palettes, rollover rules
js/ink.js             handwriting engine
js/dock.js            pen dock
js/organize.js        "Buy milk at Target..." → suggestions
js/google.js          Google sign-in
js/sync.js            Calendar, Tasks and Drive sync
js/events.js          events and repeating events
js/queue.js           offline outbox for Google changes
server/worker.js      always-connected Google helper (Cloudflare Worker)
js/views/*            each section's screens
sw.js                 offline support
tests/                logic tests (node tests/organize.test.mjs, node tests/worker.test.mjs)
```

Fonts are from Google Fonts / Fontsource under the SIL Open Font License (see `fonts/`).
