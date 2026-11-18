# Testing this working branch

This branch connects Firebase registration/login and resident profiles, plus admin announcement creation/deletion with Supabase images. Resident text report submission and private tracking are now implemented locally; publish the updated Firestore rules before testing them. Admin report processing and optional confirmed map pins are now connected. Private report photos are prepared locally and require the Edge Function update described below. Analytics and full offline viewing are not ready. Image styling is deferred.

## Use a separate copy

```sh
git clone --branch neji_review_fixes --single-branch https://github.com/f0x-n3rd/CapstoneProject.git CapstoneProject-testing
```

This downloads the test branch into a new folder without changing your existing project. Open that folder in VS Code and open `index.html` using Live Server. No package installation is needed for browser testing. Use the same host, port and browser tab while navigating.

Do not merge, push, change Firebase/Supabase settings, or run deployment/setup SQL merely to test. The checked-in public configuration points to the team's shared test services. Test accounts and announcements created here are real records in those services.

## Resident-only checks

1. Register your own test account. Do not share the password. No admin document should be created for this account.
2. Confirm Account shows the name, email and barangay you entered.
3. Navigate among Home, Account and Track Reports. Temporary profile-loading failures should not send a signed-in user back to login.
4. Confirm published announcements and their images appear on Home and Announcement. Coordinate with the designated admin to create/delete a clearly labeled test announcement; confirm changes appear live.
5. Use the existing Account Log-out button. Confirm private resident pages redirect to login when opened signed out.
6. Try your resident-only credentials at `admin_interface/admin_login/admin.html`. Expect rejection. Then sign back into the resident interface if needed (a failed admin role check signs that session out).

UI denial does not prove server-side permissions. Live direct-request unauthorized Firestore/Storage checks remain pending; coordinate those separately rather than testing against someone else's data.

## Designated admin checks

Use only an account explicitly designated by the project owner. Create an announcement labeled TEST with a small JPEG, PNG or WebP (at most 5 MB). Confirm resident display, delete that test announcement, and confirm it disappears. The project owner can confirm the corresponding image was removed from the bucket.

The owner has already verified registration/profile/logout, admin login, image announcement creation, resident live display, deletion and bucket cleanup in the shared environment. Please independently report any failures.

## Report a bug

Send: page and action, expected result, actual result, browser, and relevant error text. Firefox Console's Persist Logs can retain errors across navigation. Do not include passwords, bearer tokens, or private keys.

## Automated server-handler tests

With Node 22.18+ (tested here using Node 26):

```sh
node tests/image-storage.test.mjs
```

These 25 tests use simulated upstream responses and do not write to the cloud. They cover authorization rejection, admin revocation, image validation, path/bucket restrictions, and failure handling. A Node module-type warning may appear because this browser project has no package.json; the test pass/fail output is separate.

For maintainers setting up a different environment, see `firebase/SETUP.md` and `supabase/SETUP.md`. Those provisioning instructions are not required for the teammate testing the existing shared environment.

## Resident report checks (project owner publishes updated rules first)

1. In Firebase Console → Firestore Database → Rules, the project owner replaces the rules with the current root `firestore.rules` and publishes them. Text/map-only reports need no Supabase update; photos require the function update below.
2. Reload the app through Live Server. Open Track Reports → Create New Report.
3. Select a category and barangay, then enter a street/landmark and description labeled TEST. The map and one photo are optional; deploy the report-photo function before testing photos.
4. Submit once. Expect a confirmation with the report reference and status **Received**, then find the report in history and View Details. Reload and confirm it remains.
5. The project owner can check `reports/{reference}` in Firestore: `submitterID` matches the submitting account's Authentication UID; `timestamp` and `updatedAt` are server timestamps.
6. In another browser/profile, sign in using a second resident-only test account. Its history must not show the first account's report. Submit a second report and check both accounts see only their own.
7. Leave a required field empty: submission should be blocked. Disconnect before submitting a completed form: expect an offline message with the draft retained. Reconnect and retry.
8. If the connection drops during a submission, keep the page open until it confirms or fails. A pending card must say **Sending — not yet confirmed**, never claim successful submission early. Repeated Submit clicks must not create duplicates.
9. Confirm announcement creation/display/deletion still works. Use the admin processing checks below as well.

Residents cannot edit/delete submitted reports. Admins may update only processing fields; report deletion remains denied. The owner may clean up only explicitly labeled test documents through the Firebase Console. No automatic deletion is performed.

### Local report checks

Verified locally: 12 resident report tests, 7 admin/map tests, 16 Firestore emulator rule tests, and the existing 25 image-handler tests passed (60 total). The user confirmed the earlier text report saves and survives refresh; the new admin/map flow still needs live browser testing.

Run `node tests/reports.test.mjs` for validation, owner-query/account-switch handling, write confirmation, duplicate-send prevention and simulated page behavior. These tests mock the Firebase SDK and DOM; they do not replace browser testing.

For actual rules testing, start a local Firestore emulator with this repository's `firestore.rules`, project `demo-capstone-reports`, and an unused local port. With the official standalone Firestore emulator JAR already downloaded:

```sh
java -jar /path/to/cloud-firestore-emulator.jar --host 127.0.0.1 --port 8085 --project_id demo-capstone-reports --rules /absolute/path/to/CapstoneProject/firestore.rules
```

In another terminal, from the repository root:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 node tests/reports-rules.test.mjs
```

This suite uses only loopback requests and synthetic emulator identities. It checks real rule enforcement for valid submission, owner/admin reads, blocked cross-account/unfiltered reads, invalid fields, forged timestamps, admin-only processing edits, protected resident fields and forbidden deletes. Restart the emulator with an empty database before rerunning; tests intentionally create fixed fixture IDs. No real credentials or live Firebase data are used.

## Admin processing and map checks

Publish the latest root `firestore.rules` again before testing this milestone.

1. Sign into the admin dashboard. The existing resident test report should appear on both Dashboard and Report Management with the resident's name. Search by name, report ID, category, barangay or status.
2. Open **View details / process**. Change status to **For Verification**, assign a priority/routing level if appropriate, and enter an optional referral destination. Click **Save changes** and wait for confirmation.
3. Verify the resident's Track Reports details show the changes without refresh. Refresh both pages; the saved processing fields should persist and the original submission date, description and owner should remain unchanged.
4. Test all six statuses. Optional priority/routing values can be returned to **Not assigned**; an empty referral destination clears that value.
5. With two admin tabs open, edit the same report in both. Save one first. The other must reject its stale edit and offer **Reload saved values**, rather than overwrite the newer update.
6. Create a new resident report. Selecting a barangay centers/zooms the map; it must not create a report pin automatically.
7. Tap the map or drag the marker to the issue location. Confirm the checkbox, then submit. In admin details and resident details, **Open in Google Maps** should open that saved point.
8. Move the marker: confirmation must reset. Change barangay: the old pin must disappear and the map must recenter. Remove the pin: submission should still succeed using the required barangay/landmark fields.
9. The older text-only report should show **No map pin supplied** on the admin page. No fake coordinates or placeholder photo images should appear.
10. Disconnect before an admin save: edits must remain available and no successful save should be claimed. On a failed map load, residents can continue with text fields only; map tiles are not available for offline download.
11. With the project owner's own designated test admin only, removing its `admins/{uid}` document should clear loaded report details and block subsequent updates. Restore the test role through the Console only if further admin tests are needed.

Run `node tests/admin-reports.test.mjs` for simulated admin subscription, role revocation, concurrent-edit protection, form behavior, map confirmation/reset behavior, and Google-link validation. These are simulated UI tests; real browser testing is still required.

### Map reference data

`interface/barangay-centers.mjs` contains approximate viewing reference points from the [PhilAtlas Odiongan barangay profiles](https://www.philatlas.com/luzon/mimaropa/romblon/odiongan.html), checked 2026-09-14. Each entry's source is the corresponding linked barangay page. These are not surveyed boundaries or automatically recorded issue locations; residents explicitly place and confirm their own pins.

The picker uses [Leaflet](https://leafletjs.com/reference.html) with standard OpenStreetMap tiles and visible attribution. Tiles load on demand; no bulk/offline tile downloads are implemented ([tile policy](https://operations.osmfoundation.org/policies/tiles/)). Google links use the saved coordinates and the [Maps URLs format](https://developers.google.com/maps/documentation/urls/get-started); no Google API key or database URL field is needed.

## Private report photos — new deployment required

First follow **Update the existing project for private report photos** in `supabase/SETUP.md`: redeploy the existing `image-storage` function, keep its legacy JWT verification off, publish the latest Firestore rules, and keep `report-images` private. No new SQL policy or secret is required.

1. As a resident, create a new TEST report with one small JPEG/PNG/WebP. Wait for submission confirmation, then open View Details. The photo should display without stretching.
2. Reload and reopen the report. Confirm the photo still loads. Open it as a designated admin and check the same photo.
3. Using a separate resident-only test account, confirm the report is absent and a direct authenticated photo request for its ID is denied. Test with consenting test accounts only; never paste real bearer tokens into chat or logs.
4. Confirm a signed-out request to the function cannot download the photo and that a public bucket URL does not serve it.
5. Try an unsupported file and one over 5 MB. The form should reject the selection. The server also validates MIME type, size and basic file signatures.
6. For a controlled upload failure, block the Edge Function request in browser DevTools while allowing Firestore. Submit a report with a photo: it should confirm the report was saved but the photo upload was not confirmed. Unblock the request, open that report’s details, click Retry photo, and if still missing, select the file under **Retry the missing photo upload**. The report ID/count must remain unchanged.
7. Attempting a second upload to an existing photo path must not replace the image. An admin can read a resident’s photo but cannot upload over it. Neither can change the Firestore reference or delete the report/photo through the app.
8. Close the details panel or sign out: the displayed private photo must clear. The app does not persist private photo bytes for offline viewing.
9. Recheck announcement image creation/deletion, report processing and map links.

The earlier text-only reports remain valid; they show No photo attached and cannot have a photo added retroactively in this stage.

Current automated verification: **76 passing tests** — 14 resident, 7 admin/map, 18 actual Firestore rules, 25 announcement handler, 9 report-image handler, and 3 photo viewer tests. The report-image handler/viewer tests simulate network/DOM behavior; hosted Supabase and real browser tests remain the project owner’s next step.

## Live admin analytics

Local checks: `node tests/analytics.test.mjs` (aggregation and simulated page behavior).

1. Sign in as an admin and open Analytics. Compare total and all six status counts with your saved reports.
2. Select a barangay, category and submission date range. All charts/counts should use the same selection. Dates use Philippine time; both endpoints are included.
3. Choose a range with no reports: expect an explicit empty message and zero counts. Reverse the dates: expect a validation message, not misleading totals.
4. Reset filters. Create a resident report or change its status in a separate browser session; analytics should update automatically.
5. Export PDF. Confirm filter text, generation time and the category/barangay/status/timeline tables match the page. The export uses tables for legibility, without private report details.
6. Sign out or use a resident-only account: analytics must not display private aggregates. A connection failure must not be presented as an empty database. Cached totals are labeled and PDF export is disabled until a server snapshot arrives.

No new Firestore rules, indexes or Supabase deployment are required for analytics.

## Resident offline viewing / PWA

Local tests: `node tests/offline.test.mjs`. No console rules or Supabase redeployment needed.

1. Keep your local web server running. While online, sign in as a resident, open Home and wait for the offline preparation notice to disappear. Reload once to ensure the new service worker controls the page.
2. Visit Account, Track Reports and Announcements and let their data finish loading. View an announcement image to cache it.
3. Disconnect internet (leave the local web server running). Navigate between resident pages and refresh. Previously loaded profile/report/announcement text should remain, with an offline/saved-data notice. Unloaded information should say it has not been saved, not claim the database is empty.
4. Report submissions should require reconnection. Private photos and map tiles require internet; the worker never saves these. Cached public announcement images are limited to 20.
5. Reconnect. Reports and announcements should refresh, and the Account page should reload its profile. Confirm new admin processing changes reach the resident again.
6. Sign out while offline. Expect the offline sign-in-required page. Back/refresh must not restore private account information. Reconnect, sign in as another resident and check that the earlier resident's saved reports/profile are absent.
7. In a browser that supports PWA installation, test its Install/Add to Home Screen option. The manifest starts on the resident Home page. Installation does not extend the sign-in session: closing/reopening may require signing in online again.

Account data uses sessionStorage, is UID-scoped, and is cleared on logout/account changes. It survives navigation/refresh in the current session, not guaranteed browser restarts. Storage restrictions/quota can prevent saving; online functionality should still work. Static app files remain cached. Service workers require HTTPS or localhost; a plain HTTP LAN address on a phone will not enable offline setup.

### In-app notifications

Publish the updated `firestore.rules` before testing/deploying this frontend. No Supabase update is required. Existing report data is not backfilled with notifications.

1. As a resident, submit a new report. As an admin, open the header bell: one new-report entry should appear with an unread badge.
2. Open the entry: Report Management opens that report and the entry becomes read. A second admin retains their own unread state.
3. Change its status or referral destination. The owner receives an update; another resident does not. Changing only priority must not create an event.
4. Open the resident notification: its details open and its unread count decreases. Reopening the app online preserves read state. For persistent sign-in, opt into Keep me signed in before closing the app.
5. Existing old reports should not suddenly produce alerts. Offline notifications ask for reconnection; this is not closed-app push delivery.

Local notification coverage: `node --test tests/notifications-ui.test.mjs tests/reports.test.mjs tests/admin-reports.test.mjs`. Firestore emulator notification privacy cases are included in `tests/reports-rules.test.mjs` and require the local emulator described above.

## Employee management (2026-10-01)

Deployment order and live test steps: `supabase/EMPLOYEE_SETUP.md`. Publish rules and redeploy image-storage before enabling employee disabling. Employee management requires a new server function and private server-only credential; a frontend deployment alone does not activate it.

Local checks: `node --test tests/employee-management.test.mjs tests/employee-access.test.mjs tests/employees-ui.test.mjs tests/admin-routing.test.mjs tests/admin-reports.test.mjs tests/notifications-ui.test.mjs tests/image-storage.test.mjs`. The Firestore emulator suite additionally checks disabled-admin reads/writes and denied client privilege escalation. Mocked backend tests do not verify real email delivery or Supabase runtime compatibility.

Admin password recovery: run `node --test tests/admin-password-reset.test.mjs tests/admin-routing.test.mjs`. On admin login, expand **Forgot password?**, enter a test account email, and request a link without entering a password. Expect neutral feedback and a 60-second button cooldown. Check inbox/spam, complete Firebase's reset form, and sign in with the new password; permissions should remain unchanged. An unknown email should show the same neutral feedback. Offline requests should ask you to reconnect. The cooldown is client-side convenience; confirm Firebase Email Enumeration Protection separately for protection of raw API responses.

Resident login also has **Forgot password?**, using the shared recovery module. Repeat the email/new-password/old-password checks with a resident test account; verify its existing reports remain accessible. Recovery must not change the Keep me signed in choice. Both login pages share the same per-tab reset cooldown.
