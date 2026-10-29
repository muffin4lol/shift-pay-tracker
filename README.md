# Shift Pay Tracker

A responsive React + Vite + Tailwind app for tracking shifts, estimated gross earnings and actual payouts. Local-only data, no backend, no analytics. Features: multiple named hourly rates and currencies, frozen pay snapshots, overnight shifts, breaks, special-day rules, Monday–Sunday summaries, reconciliation, eight-week chart, light/dark mode, CSV and versioned JSON backups.

## Start locally

Install Node.js 22.12 or later from https://nodejs.org/ (choose the current LTS). Open a terminal in this folder:

```sh
npm ci
npm run dev
```

Open the Local URL printed by Vite. For a production build:

```sh
npm test
npm run build
npm run preview
```

Build command: `npm run build`. Output directory: `dist`. Install command: `npm ci`. No environment secrets required. `npm test` uses Node's built-in test runner. The lockfile pins the installed dependencies.

## First use

1. Open Settings and edit the example rate to your actual agreed hourly pay. The starter €14.15 rate is only an editable placeholder.
2. Review Sunday and public holiday rules. Defaults are 1.5× and 2×, which are examples, not legal guarantees.
3. Add shifts with their name, date, start/end and unpaid break. The form previews the estimate.
4. Review Weekly view with previous/next arrows.
5. Record money received under Payouts, selecting any date in the week covered. Multiple payouts per week are summed. Explicitly record zero if you need to mark a week as unpaid.
6. Settings → Download JSON backup regularly. Restoring a backup validates then replaces this browser's records after confirmation. CSV includes both shifts and payments; use JSON for restores.
7. Use the top-right currency selector to view one currency at a time.

## Calculation assumptions

- Estimates are gross pay; tax, statutory holiday benefit eligibility, overtime and pension deductions are not calculated.
- A shift belongs to its start date for holiday/Sunday rules, month and Monday–Sunday week grouping. Overnight shifts do not split at midnight. Times are local wall-clock times; daylight-saving changes do not change the number of scheduled hours.
- Equal start/end times are rejected (not interpreted as 24 hours). Breaks must be whole minutes, nonnegative and shorter than the shift. End before start means the next day.
- Highest matching multiplier wins; flat bonuses stack on top. Flat bonuses are expressed in each shift's currency. A bonus applies once per shift, not per hour.
- Pay uses integer minor units rounded per shift. Base and total are independently rounded, and extra = total − base. Rates have two decimal places in the form. Supported currencies all use two decimal places.
- Saving a shift copies its rate and resulting calculation. Editing settings never changes saved pay. Editing a shift's name alone preserves its snapshot. Changing the date, times, break or rate recalculates with current bonus rules; choose the saved rate option to retain the historic hourly rate.
- Monthly earnings mean estimated pay for shifts starting in the current month, not cash received in that month.
- Reconciliation groups payments by the week they cover, regardless of received date. Pending weeks are excluded from the running difference. Positive or zero is green, negative is red. Part payments count as recorded payments, so a week may look short until the remainder arrives.
- Currencies are never added together or converted. Choose a display currency to see that currency's totals.
- Holidays initialize for the current year on first use, and remain editable. Add next year's dates manually. Fixed-date holidays are not moved to substitute Mondays.

Irish holiday dates and the St Brigid's Day exception were verified against the Workplace Relations Commission: https://www.workplacerelations.ie/en/what_you_should_know/public-holidays/ . Premium multipliers are configurable examples; actual statutory benefits depend on circumstances and employer arrangements.

## Privacy and storage

Data lives in localStorage for this site's origin and browser profile. The app sends no shift or payout records to a server. People visiting the same public URL in their own browsers have separate records. People with access to your browser profile can read yours. Browser extensions with appropriate access may also read it. This is not encrypted storage or an account login.

Clearing browser data, private browsing expiry, changing origins, or losing a device may remove access to records. Export a JSON backup before moving from the local preview to your live URL, then import there. JSON and CSV contain your personal records: store them privately and do not commit them to the source repository. The app needs connectivity to load its assets; offline installation is not implemented.

Storage failures show an error and do not update the in-memory data. Invalid existing storage is not automatically overwritten on startup. Restore a valid backup before editing if an initial corruption warning appears.

## Folder guide

```text
.github/workflows/deploy.yml  Test, build and deploy on main; test/build PRs
src/main.jsx                 React UI, forms, chart and navigation
src/style.css                Tailwind import, theme and responsive styling
src/pay.js                   Pure date, holiday, hours and pay utilities
src/storage.js               Repository adapter, validation, CSV and downloads
tests/pay.test.js            Pay, reconciliation and backup tests
index.html                   HTML entry and metadata
vite.config.js               React/Tailwind plugins and portable base path
package.json                 Commands and dependencies
package-lock.json            Reproducible dependencies
.gitignore                   Excludes build, packages and local secrets
```

## Deploy from a blank GitHub account

**Recommended host: GitHub Pages.** It provides a free `github.io` URL for a public repository and builds after every push to `main`. The included GitHub Actions workflow tests before publishing. No second host account, paid domain, backend or deployment secret is required.

### 1. Create your account and repository

1. Visit https://github.com/signup and create an account. Complete email verification and any account checks yourself.
2. Sign in, select the **+** menu → **New repository** (or https://github.com/new).
3. Set the repository name to **shift-pay-tracker** and visibility to **Public**. Leave the README, .gitignore and license initialization options unchecked because this folder already contains files and Git history.
4. Click **Create repository**. Copy the HTTPS repository URL shown, such as `https://github.com/YOUR-USERNAME/shift-pay-tracker.git`.

### 2. Push this source

Install Git from https://git-scm.com/downloads if needed. This delivered folder already has a local Git repository and commits. In a terminal opened inside this folder:

```sh
git status
git remote add origin https://github.com/YOUR-USERNAME/shift-pay-tracker.git
git push -u origin main
```

Replace YOUR-USERNAME with your real GitHub username. If `origin` is already set, inspect `git remote -v` and use `git remote set-url origin YOUR-REPOSITORY-URL` if necessary. GitHub no longer accepts your account password for Git-over-HTTPS. Use GitHub CLI's `gh auth login` (choose GitHub.com, HTTPS and browser login), Git Credential Manager, or GitHub Desktop to authenticate. Never paste tokens into app source files or public chats.

If using GitHub Desktop: **File → Add local repository**, choose this folder, then **Publish repository**, use the name `shift-pay-tracker`, uncheck “Keep this code private,” and publish. Avoid publishing the parent outputs folder.

If you downloaded source without the `.git` folder (some archive tools omit hidden files), initialize first:

```sh
git init -b main
git add .
git commit -m "Build Shift Pay Tracker with tested pay calculations"
```

Then add the remote and push as above.

### 3. Enable hosting and deploy

1. On the GitHub repository page, choose **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**. Do not select a branch source or add another generated workflow.
3. Open **Actions → Test and deploy to GitHub Pages**. Select **Run workflow → main → Run workflow**. A first automatic run may have failed if Pages was not yet enabled; manually rerun after enabling it.
4. Wait for `build` and `deploy` to turn green. The `github-pages` deployment includes the live URL.
5. Visit `https://YOUR-USERNAME.github.io/shift-pay-tracker/`. The exact address is also under **Settings → Pages**.

Configuration is already provided: Node 22, `npm ci`, `npm test`, `npm run build`, output `dist`. The workflow sets `BASE_PATH` to `/<repository-name>/` so project assets resolve correctly. The local default `./` is portable. If using an account-root repository named `YOUR-USERNAME.github.io`, change the workflow's `BASE_PATH` to `/`.

### 4. Verify the live app

- Open the live URL and check there are no blank pages or missing assets.
- Set a rate and add a weekday shift. Verify hours/pay against a manual calculation.
- Add an overnight shift and a Sunday shift, and verify their previews and bonus labels.
- Record a payout, inspect its covered week's difference, then refresh to confirm persistence.
- Open on your phone and check navigation, shift entry and horizontally scrollable tables.
- Download a JSON backup, then restore it and verify the counts.
- Remember local preview data does not automatically move to the live URL: use JSON backup/restore.

### 5. Deploy updates

```sh
npm test
npm run build
git add .
git commit -m "Describe the change"
git push
```

Every push to `main` tests, builds and publishes. Pull requests test/build without deploying. To roll back, revert the problematic commit and push the revert. Check Actions logs if deployment fails. A 404 often means Pages is not enabled or the URL is wrong. Missing assets usually mean a mismatched `BASE_PATH`.

Official references: https://vite.dev/guide/static-deploy#github-pages and https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site .

## Backend migration

The `repository` interface in `src/storage.js` owns persistence. Keep `pay.js` pure. To add Supabase/Firebase, replace load/save with an async repository, introduce loading/error handling, authenticate users and enforce per-user row security. Preserve versioned snapshots, validate remote data, resolve concurrent edits and provide migration from JSON. Never use a service-role key in frontend code.

## Future improvements

- Login, encrypted backups and cloud sync with per-user access controls.
- Tax and pension estimates configured for the user's circumstances.
- PDF payslip exports and attachment support.
- Overtime rules and split-at-midnight premiums.
- Offline installable PWA and shift reminders.
- Multiple currency conversion with explicit exchange rates.

## Verification and release status

The accompanying DELIVERY.md records the checks completed in this environment and any publishing limitations. A production build and automated utility tests do not replace a device/browser acceptance test for your own work pattern.
