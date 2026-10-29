# Account release validation · 29 October 2026

- Supabase project URL and public publishable key configured locally; the key is not a database-administration credential.
- Remote checks: Auth settings respond, email login and confirmation are enabled, Phase 2 account_bootstrap exists, anonymous access to profile records and account bootstrap is denied.
- The owner confirmed admin SQL for the chosen login email and both authentication hooks are enabled.
- All 42 automated tests pass, including PostgreSQL authorization/persistence tests and weekly roster tests.
- Production build passes with account configuration and required-auth enabled.
- Original browser-only records are preserved. After approved sign-in, Account offers a download of the original browser backup for explicit migration to the user-specific local workspace.
- Protected login, signup, confirmation, recovery, whitelist RBAC, profile editing and preference persistence are implemented.
- Weekly batch shift entry remains included.
- Hosted signup/mail delivery and a successful signed-in admin session require the owner to choose a password and verify email. Those end-to-end steps are not claimed complete by these build/database checks.
- Profiles and preferences persist in Supabase. Financial records remain browser-local and account-specific.

App: https://muffin4lol.github.io/shift-pay-tracker/

Deployment results: https://github.com/muffin4lol/shift-pay-tracker/actions

See PHASE2.md for the complete setup, API and hosted acceptance checklist.
