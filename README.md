# Worth Valley Calendar

A lightweight website that shows a whole year of local events like a wall calendar.
Visitors click a day to see what's on, with times, prices, ticket links, and each
organiser's opening times and FAQs. Each business gets its own login to add and
update only its own events. The site admin manages businesses, logins and the
site-wide FAQ.

No packages to install: it needs only **Node.js 22.5 or newer** and stores
everything in one SQLite file (`data/calendar.db`).

## Run it on your computer

```sh
node server.js create-admin you@example.com   # prints your password
node seed-demo.js                              # optional: example events to look at
node server.js                                 # open http://localhost:3000
```

Sign in at `/login`. To start clean after trying the demo, stop the server and
delete the `data` folder.

## How it works

| Who | What they can do |
| --- | --- |
| Visitors | See the year, click any day, open ticket and info links, read "Who's who" and the FAQ |
| Business login | Add, edit, copy and delete their own events; edit their opening times, contact details and FAQ |
| Admin | Everything above for every business, plus add businesses, create logins, reset passwords, and edit the site name, tagline and FAQ |

Events can last several days (a festival weekend) and can repeat every week, every
two weeks or every month, with an optional end date.

FAQs are written as plain text: the question on one line, the answer underneath,
and a blank line between questions.

## Put it online

Any host that runs Node.js **and keeps files between restarts** will do, because
the events live in `data/calendar.db`.

### On Railway (recommended)

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick this repository. It builds from the `Dockerfile`.
2. Open the service, right-click it (or use the command palette) and **Add Volume**, mounted at `/data`. This keeps your events safe across deploys.
3. Under **Variables**, add `ADMIN_EMAIL` (your email), `ADMIN_PASSWORD` (at least 8 characters) and `SECURE_COOKIES` = `1`.
4. Under **Settings → Networking**, click **Generate Domain** for a free address, or add your own domain there.
5. Visit the address, sign in at `/login` and change your password under **My account**. You can then delete `ADMIN_PASSWORD` from the variables.

### Other hosts

- **A small VPS** (Hetzner, DigitalOcean, etc.): copy the folder over, run
  `node server.js` under a process manager such as systemd or pm2, and put Caddy
  or nginx in front for HTTPS.
- **Fly.io, Render or Railway**: deploy with the included `Dockerfile` and attach
  a persistent volume mounted at `/data`.

Settings (environment variables):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for the database |
| `SECURE_COOKIES` | off | Set to `1` once the site is on HTTPS |

Back up by copying `calendar.db` (for example, a nightly copy to another disk).

## Sharing a preview

`node build-preview.js` writes `preview.html`, a single file with the public
calendar and the current events baked in. It opens in any browser without a server.
