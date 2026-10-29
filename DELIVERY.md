# Delivery status · 29 October 2026

Live app: https://muffin4lol.github.io/shift-pay-tracker/

Source: https://github.com/muffin4lol/shift-pay-tracker

Successful initial test, build and deployment run: https://github.com/muffin4lol/shift-pay-tracker/actions/runs/40901112957

## Verified

- All 15 unit tests pass.
- Vite production build passes locally and in GitHub Actions.
- GitHub Pages build and deployment jobs both completed successfully.
- Public URL opens the React app with its styles and navigation.
- Browser check: adding an eight-hour shift at €14.15 produces €113.20 and updates the dashboard.
- Browser check: that shift survives refreshing the page.
- Browser check: entering a €100 payment against the €113.20 estimate shows a €13.20 shortfall.
- App opens with empty records on the public origin; sample QA records were used only on localhost and are not included in source or deployed data.
- Source uploaded via GitHub's signed-in browser interface because terminal Git had no saved credentials. Local Git history is synchronized with the public repository.
- GitHub Pages configured to use GitHub Actions. Every push to main runs tests, builds, then deploys; pull requests run test/build only.

## Limits

- Responsive layouts are implemented; physical-phone acceptance testing was not performed.
- JSON validation and CSV generation are tested as utilities. Full browser file download/restore acceptance testing remains a recommended user check.
- No backend, account login, cross-device sync, tax calculation or offline PWA.
- GitHub Actions reported non-blocking runtime deprecation notices for bundled action versions and the ubuntu-latest migration. The initial deployment succeeded.

See README.md for all calculation assumptions, backup/privacy details, exact setup and deployment instructions, backend migration notes and future ideas.
