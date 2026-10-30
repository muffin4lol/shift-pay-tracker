# Phase 3: account cloud workspace and Irish payroll estimates

## What existed

React 19 / Vite static GitHub Pages app; Supabase email login and verified whitelist, DB-enforced administrator roles, profile and JSON preferences. Shift pay snapshots preserve historic rates. Rates, shifts (including breaks), payouts and Sunday/holiday rules previously used `shift-pay-tracker:v1:user:<UUID>` in localStorage. Original pre-login records used `shift-pay-tracker:v1`. No tax settings or tax engine existed. Profile and preferences were already cloud-backed in `profiles` and `user_settings`; they are not migrated to a new identity or project.

## Architecture and ownership

- `src/storage.js`: validates v1 backups and keeps original local adapters for migration/local development.
- `src/sync.js`: versioned cloud repository, account-scoped durable offline cache/outbox, automatic reconnect/retry, CAS conflict resolution.
- `src/useWorkspace.js`: loading gate, focus/30-second refresh and reconnect integration.
- `src/account/AccountProvider.jsx`: existing profile/preferences RPCs plus an account-scoped durable retry queue. Queued edits are applied immediately; online DB version checks reject stale edits. Retry/discard/download controls are in Account. Account updates can show “queued” before the server acknowledges them; consult the account sync status.
- `src/tax/2026.json`: verified annual rates with per-value source and verification date. `engine.js`: pure tax calculation. `TaxPanel.jsx`: employer allocations and gross-to-net views.
- `public.workspaces`: one atomic JSON document per `auth.uid()`, containing rates, shifts, pay snapshots, payouts, rules, optional tax preferences. Indexed primary-key lookup, 10MB workspace limit. Profile/preferences stay in existing tables. A future record-level schema can replace this adapter; this initial schema optimizes atomic consistency for a personal tracker.
- Public RPCs: `POST /rest/v1/rpc/load_workspace` and `POST /rest/v1/rpc/save_workspace` with `{p_payload, p_expected_version}`. Server generates `version` and `updated_at`. Initial insert expects version 0; updates compare the exact previous version. PT409 means review a conflict. Direct writes and anonymous reads are denied. Both read and write recheck verified whitelist membership, regardless of token claims. Admins do not get access to other members’ financial rows.

Database is the source of truth. localStorage stores only account-scoped cache/outbox and preserved old backups. Cache failure blocks saving rather than falsely reporting success. “Saved to cloud” appears only after acknowledgement. Reconnect uploads queued changes. If another device changed the cloud version, there is no silent last-write-wins data loss: download local edits, then choose cloud or explicitly replace cloud. Account profile/preference conflicts similarly require downloading queued edits and reloading the cloud account version. Online authorization is enforced at every RPC; an already-rendered offline cache cannot learn about revocation until connectivity returns. Initial sign-in still requires network access; this is not an offline-installable PWA.

## Apply before publishing

Use the **existing** Supabase project `atucytsbvcwyzqkjycqn`. No new account, project or keys are needed.

1. Download a JSON backup from the current live tracker on every device with unique data.
2. Supabase dashboard → existing project → SQL Editor → New query.
3. Open `supabase/migrations/202610300001_workspace.sql`, copy its **entire SQL contents**, paste and Run. Do not paste the pathname. This runs after the existing Phase 2 migration; it adds a table and RPCs without deleting existing data. Run once.
4. Keep the existing whitelist and both authentication hooks enabled. No changes to public variables are required.
5. Publish this source to the repository's main branch. The existing Actions workflow runs tests/build and deploys Pages. Do not deploy this frontend before applying the SQL; it intentionally blocks editing if its cloud endpoint is missing.
6. Open the live site, sign in on the laptop with the old records first, wait for **Saved to cloud**, then use the second device.

## Migration behavior and assumptions

Account-scoped old records are automatically uploaded when the cloud workspace is absent. Each device also performs one idempotent merge of its previously saved identity-scoped arrays into an existing cloud workspace: append IDs that do not exist, retain cloud records for an existing ID. Rules/tax are copied from the old workspace only when the cloud has no shifts or payouts. Original keys remain untouched for recovery. Migration completion is marked only after a successful acknowledgement; IDs plus compare-and-swap prevent duplicate records on retries or concurrent first logins. A device with different edits under the same existing ID retains its old backup, but the cloud copy wins during this one-time migration—review backups if you edited the same old record on two devices.

Pre-login unscoped records are **not automatically attributed to whichever account signs in** on a shared computer. Account → Download original browser backup, then Settings → Restore JSON backup explicitly assigns them. Import replaces the account workspace after confirmation; export the cloud workspace first if it already has records. This is an intentional ownership safeguard.

All shifts keep their historic gross-pay snapshot. Break minutes are part of each shift, not a separate break-rule table. Holiday/Sunday rules and tax settings travel with the workspace. Non-EUR shifts are excluded from Irish tax; no exchange rate is assumed.

## Tax assumptions and correct interpretation

- Supported and verified tax year: **2026**, not the announced 2027 budget. Dates outside 2026 are blocked. Warning appears after the config review date/year. To add a year, copy the versioned JSON, independently verify each value, register/select that year in the engine/UI and add boundary tests; do not reuse the old year's figures.
- Each **unique rate name** represents an employer for tax calculations. Use distinct names if two employers pay the same hourly rate. Rename carefully: historic shift snapshots retain the old employer name. Tax setup is saved per employer name.
- Weekly periods use Monday–Sunday, fortnightly starts on the selected date’s Monday, monthly uses the calendar month. Choose the actual pay date for the effective PRSI rate. Weekly/fortnightly/monthly credits and bands are prorated by 52/26/12. Estimates use shift dates rather than employer payroll cut-off rules.
- Default basis is Week 1/Month 1 to avoid fabricating missing YTD history. It is **not emergency tax**. Cumulative needs the true tax period plus prior taxable pay, prior PAYE, prior USC gross and USC already paid from payroll/RPN; negative deductions can refund tax actually paid earlier. Unused credits alone never produce a payment.
- Emergency/no RPN: zero credits, single-person band only during the first four employment weeks if PPSN supplied; otherwise full higher rate, USC at emergency rate. For pay periods straddling emergency week 4/5, split the estimate into weekly runs with the appropriate gross; the UI does not infer uneven weekly earnings within a fortnight/month.
- Married main earner gets the one-income band; lower earner's non-transferable increase is capped at that earner's income and the configured maximum. Prefer actual employer RPN allocations, particularly for joint assessment and multiple jobs. The app does not duplicate a combined €88,000 band across employers.
- Secondary jobs default to zero PAYE credits/band. Enter each employer’s allocated annual PAYE credits and cut-off, plus each employer's USC cut-offs. Expected USC annual income is across **all jobs** for the exemption/reduced-rate tests. Do not duplicate the default USC cut-offs across jobs; copy Revenue’s allocation. RPN values override manual PAYE credits/bands; no PPS number, Revenue password or RPN document is collected.
- Extra credits are approved euro amounts of tax relief, not the medical/rent bill. Flat-rate expense allowances separately reduce taxable income. PAYE credits do not reduce gross pay or USC/PRSI.
- USC includes premiums and is calculated before employee pension deductions; exemption is all-or-nothing using expected annual income. Full medical card or age70+ reduced rates require income <= configured limit.
- PRSI A subclasses derive from earnings; J/M can be selected explicitly. Under16 is exempt, ages16–17 are **not** automatically exempt. At66–69 PRSI continues unless State Pension is awarded or the legacy pre-1958 exemption applies; age70 is exempt. Employee rate changes on 1 October2026. Employer PRSI is not deducted from net pay. Monthly thresholds/credit use a 52/12 week equivalent.
- Pension percent assumes an employee contribution eligible for PAYE relief. USC/PRSI are unchanged. Age-related annual pension-relief ceilings, automatic enrolment, tax exemption/marginal relief for older earners and benefits-in-kind are outside this estimator. Confirm these cases with payroll.
- Union, insurance cash contribution and other deductions default to after-tax. Cycle to Work is treated as employer-confirmed qualifying salary sacrifice reducing PAYE/USC/PRSI bases; the employer must check scheme eligibility/limits. Insurance benefits-in-kind are not inferred from the cash deduction.

Official sources are linked in the Tax tab and JSON. Citizens Information was consulted for PRSI credit/classes; some current pages returned403 to direct fetch, so 2026 PRSI rates were cross-checked against the Department of Social Protection’s current Class A table. Revenue confirmed PAYE/USC figures, emergency rules, Week1 examples, cumulative refunds, pension USC treatment and Cycle to Work treatment.

## Verification

`npm test` executes pay, roster, account validation, real PostgreSQL (PGlite) authorization/CAS/RLS and tax/sync tests. The sync tests use independent browser-storage adapters against a shared server stub; database tests independently exercise the actual SQL. Hosted cross-device acceptance still needs two real devices.

Manual acceptance (record date/browser/build and results):

1. Apply SQL; deploy. Device A: sign in as whitelisted user, add a uniquely named rate, a Sunday overnight shift with unpaid break, a payout and tax pension setting. Edit profile bio and theme. Wait for both workspace/account cloud acknowledgements.
2. Device B (different browser/storage): sign into the **same app account**, verify profile/theme, rate, exact shift snapshot/breaks, payout, rule and tax setting. Reload both devices: values persist.
3. On A disable network without signing out, edit a shift and account bio/theme. Confirm queued/failure status, original data still visible. Reconnect, retry, wait for acknowledgements. Focus B and wait <=30seconds for workspace, <=60seconds for account refresh. Verify edits.
4. Load both devices, disconnect B, edit the same shift on A and save. Edit on B then reconnect. Verify conflict warning and A is not silently overwritten. Download B's backup, select cloud; verify A's edit. Repeat with explicit keep-local and verify that replacement is deliberate.
5. Sign into a second whitelisted account: none of the first account’s financial records appear. Revoke first account through Admin: its online reads/writes fail, even with an existing token.
6. Test first-login migration with old records on A and blank B; then reverse order. Verify arrays do not duplicate after reload/retry. Keep all original backups.
7. Tax → weekly €400/€850/€250 Week1 PAYE should be €3.08/€93.85/€0. Emergency €900 week1 =€190.77 PAYE, week5 =€360; USC€72. PRSI€700: Sep30=€29.40, Oct1=€30.45. Check monthly/fortnightly, reducedUSC, RPN zero allocation, pension and cumulative refund fixtures in tests.

Rollback: restore prior frontend commit via GitHub (do not drop the new table or delete old keys). Export cloud JSON before changing anything. Financial cloud rows are only created by this release; older frontend will continue using original local data and will not read the new cloud edits.
