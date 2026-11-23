# Circle: simulated social feed for an anonymity study

A scripted social feed (like, comment, repost, report, block) for testing whether **perceived anonymity** changes cyberbullying-type behavior. Every participant sees the identical feed. Nobody can see anyone else, because every other "user" is pre-written by you.

Three between-subjects conditions (shown to the participant only):

| Condition | Participant sees |
|---|---|
| `named` (not anonymous) | Their name + photo (set by you, locked). Fake users show full names. |
| `pseudonym` | A username they choose once: **A)** 2 initials + up to 4 digits, or **B)** first name + interest (max 30 chars). Fake users show matching pseudonyms. |
| `anonymous` | "Anonymous User #1234" (random, locked), generic silhouette. Fake users are also "Anonymous User #...". |

## One-time setup (about 15 minutes)

### 1. Backend (Google Sheet + Apps Script)
1. Create a new Google Sheet (private, in your university Google account if required by your IRB).
2. **Extensions → Apps Script.** Delete the default code and paste the contents of `Code.gs`. Save.
3. In the function dropdown choose **`setup`** and click **Run**. Approve the permissions. This creates the tabs and loads placeholder stimuli.
4. **Project Settings (gear icon) → Script properties → Add property:** name `ADMIN_PASS`, value = a long passphrase. (This is your dashboard login. Replace the `CHANGE_ME` placeholder.)
5. **Deploy → New deployment → type: Web app.** Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the URL ending in `/exec`.
6. If you ever edit `Code.gs` later: **Deploy → Manage deployments → edit → New version**, otherwise the old code keeps running.

### 2. Website (GitHub Pages)
1. Open `config.js` and paste the `/exec` URL.
2. Create a GitHub repo, upload everything in this folder (Code.gs is only needed in Apps Script, but it is fine to include), then **Settings → Pages → Deploy from branch → main / root**.
3. Participant page: `https://<you>.github.io/<repo>/`  Dashboard: `.../admin.html`

## Running the study

1. **Dashboard → Fake users / Feed / Text & settings:** replace the placeholder users, posts and comments with your stimuli (tag each post: neutral, good, clear violation, ambiguous, digital footprint). Paste your IRB-approved debrief and withdrawal text. Preview each condition from the **Preview** tab (previews record nothing).
2. **Participants tab:** paste names from your signed consent forms, one per line, once recruiting is done click **Randomly assign** (balanced across the 3 groups). Take each person's photo with **Camera** at the session (or upload a file). Photos are shrunk to 160px and shown only to the "not anonymous" group.
3. **Lock the feed** (Feed tab) before the first participant so nobody can accidentally change the stimuli mid-study.
4. Run each participant: give them their **code** (or send the link from **Download links**). Flow: code → intro → profile step for their condition → feed → "I'm finished" → debrief with a **Remove my data** button.
5. **Data tab → Load events** to download the raw event log and a per-participant summary (counts of each behavior split by post type, plus dwell time per post type). Exports contain codes only, no names.

## What gets logged (Events sheet)
`feed_enter, profile_set, post_view, like/unlike, comment (with text), comment_like/unlike, repost (with note), report_post/report_comment (with reason + details), block, post_dwell (ms visible), finish`. Every row has a timestamp, ms since start, the participant code, condition, and the **post type** (joined server-side from your tags; participants never see the tags).

## Notes and limits
- **Withdrawal:** the debrief button, or **Remove data** on the dashboard, deletes that person's events, photo and pseudonym and marks them withdrawn. Google Sheets keeps **version history**, so to fully purge photos, use **Delete all photos** and then also delete old versions (File → Version history) or copy the sheet to a fresh one.
- **Privacy:** keep the Google Sheet private. It contains names (Participants tab). The GitHub repo contains no data.
- **Refreshing mid-session** is handled: likes/blocks/comments are restored in that browser from `localStorage`; a different device would start the feed view fresh.
- **Admin security:** the passphrase is checked server-side but travels with each dashboard request over HTTPS. Use a strong, unique passphrase and don't share the dashboard URL.
- **Avatars:** fake users use colored initials (or the silhouette in the anonymous group). Only the participant has a real photo, in the named condition.
- **Wording:** keep the anonymity instructions to claims that are true of the platform (e.g. "other users cannot see who you are") and run the exact wording past your IRB, since participants' names are on the consent form and codes link to them.
