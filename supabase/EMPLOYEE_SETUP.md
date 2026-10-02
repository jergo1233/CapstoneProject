# Employee account management setup

The code is local until deployed. The employee page is main-admin-only; an ordinary Admin account will not see its navigation link.

## Deploy in this order

1. Publish the repository's updated `firestore.rules` in Firebase. Existing admin profiles without `active` keep working; `active: false` blocks admin data access.
2. Redeploy **image-storage** using the updated `supabase/functions/image-storage/index.ts`. Keep its existing Firebase-token verification configuration. This closes announcement image operations to disabled admins; report image reads use the updated Firestore permissions.
3. Configure the new **employee-management** function as described below, including its server secrets. Deploy both its `index.ts` and `handler.mjs`; copying only index.ts is insufficient. Keep `handler.mjs` beside `index.ts`. Disable Supabase's legacy JWT verification for this function, as in `supabase/config.toml`: the handler validates Firebase tokens itself, including revocation, and checks the current main-admin profile.
4. In Firestore, open `admins/{your Firebase Authentication UID}`. Keep `role` as the string `Admin`. Add **Boolean** `canManageEmployees: true` and **Boolean** `active: true`. Do this only for the designated main admin. Never offer these fields on public registration. Existing employee profiles may omit the fields (normal active admin, no account-management permission).
5. Deploy the frontend changes to Vercel. Open `/admin/employees` or the new **Employee Accounts** sidebar link after admin sign-in. Direct Live Server file paths continue to work.

Do not use the disable feature until steps 1 and 2 are deployed. An old image function does not enforce the new active field for announcement-image operations.

## Server-only Firebase credential

The function needs privileged Firebase access to create identities and write protected admin profiles. The existing public web API key cannot grant that access.

- In the Google Cloud project **capstone-reporting-system**, create a dedicated service account for employee management. Grant **Firebase Authentication Admin** (`roles/firebaseauth.admin`) and **Cloud Datastore User** (`roles/datastore.user`). These allow Auth management and Firestore data access; treat this credential as private. Use a dedicated account rather than a project Owner/Editor credential.
- Create/download a JSON key for that service account. Keep the file outside this repository. Do not send it in chat, put it in frontend configuration, or commit it.
- In Supabase Edge Function secrets, add:
  - `EMPLOYEE_FIREBASE_SERVICE_ACCOUNT`: the complete JSON key contents, including its private key and project ID.
  - `EMPLOYEE_FIREBASE_WEB_API_KEY`: the existing Firebase web API key from `firebase/config.js` (the API key itself is public configuration).
- The function checks the service account's project ID. It uses Firebase Admin SDK 13.5.0 and Firestore REST transport. No new Firebase Cloud Function or Firebase Storage setup is needed.
- Deploy `employee-management`. With a configured Supabase CLI, run `supabase functions deploy employee-management --project-ref lpcmwrdizcistkxylsps --no-verify-jwt` from the repository. This uploads the function and its imported handler, not the frontend. With the dashboard editor, include both files and use the same function name.

Supabase project secrets are server-side but may be available to other functions in that project; restrict who can administer the project. If a key is exposed, revoke it in Google Cloud and replace the secret.

## Employee workflow

- Add employee with name, separate work email, and office. The server creates a Firebase identity with an unshared random password and an `admins/{uid}` profile with `role: Admin`, `active: true`, and `canManageEmployees: false`.
- Firebase sends its standard **password reset** email to let the employee choose their own password. This is password setup; the main admin never sees the password. The email subject follows the Firebase Authentication password-reset template, not a custom invitation template. Check spam if needed.
- If email delivery fails, the account remains in the list. Use **Send setup email** instead of creating it again. Repeated setup requests are limited to one per minute per employee, in addition to Firebase's email limits. This button can also reset an existing employee's password through their own inbox.
- An email already registered in Firebase is rejected and is never automatically promoted, overwritten or deleted. Use a separate work email; any deliberate migration of an existing account requires separate technical review.
- **Disable access** changes the admin profile's `active` field; it does not delete the Firebase identity, revoke a resident role, or erase prior reports/announcements. Backend rules deny subsequent administrative operations. Online report/notification listeners clear when the role change arrives. Previously seen/downloaded content cannot be recalled.
- **Enable access** restores admin permissions. Main-admin accounts cannot be disabled or edited as employees. The dedicated Transfer access action described below can hand over the caller’s management permission. Initial provisioning and emergency recovery remain console operations.
- Profile metadata records createdBy/dateCreated and updatedBy/updatedAt. This is not a full action history or invitation tracking system. No password or reset link is stored in Firestore.
- If a connection fails during account creation, refresh the list before retrying. The backend avoids deleting an account when it cannot determine whether its profile write committed. Rare partial failures may require console inspection; the UI reports that explicitly.

## Verification after deployment

1. Main admin sees Employee Accounts; ordinary admin and resident cannot use its API or view the list.
2. Create a temporary employee using an email you control. Receive the setup email, choose a password, and sign in through the admin login. Check reports and announcements. The employee must not see Employee Accounts.
3. Disable that employee while they have an admin page open. Verify private reports clear and new report updates, private photo requests and announcement image operations are denied. Re-enable and reload to restore access.
4. Attempt adding the same email again: it must be rejected without changing the existing account.
5. Verify main-admin rows show Protected account, not disable/email buttons.

Local tests use mocked Firebase Admin services plus the local Firestore rules emulator. Actual Supabase edge-runtime execution, IAM credentials, Firebase email delivery and browser layout still require this deployment check.

References: [Firebase user management](https://firebase.google.com/docs/auth/admin/manage-users), [Firebase Auth REST email API](https://firebase.google.com/docs/reference/rest/auth), [Supabase function dependencies](https://supabase.com/docs/guides/functions/dependencies).

## Employee editing and main-admin handover (2026-10-01)

Redeploy **employee-management** with the latest `handler.mjs` (keep `index.ts` alongside it). Keep Verify JWT with legacy secret OFF. No new secrets, Firestore rules or image-storage changes are needed for this addition. Deploy the updated frontend afterward; Live Server can test the local frontend against the deployed function.

- **Edit details** changes only the employee's Firestore name and office. Their sign-in email, Firebase Auth display name, role and access settings are unchanged. A stale edit is rejected if another admin changed those fields; close the dialog, refresh and reopen it.
- **Transfer access** is available for active ordinary employees. The destination must have an enabled Firebase email/password account and have signed in at least once. Their Auth email must match their employee profile.
- The dialog identifies the destination, explains the loss of account-management permission, asks for the current main admin's password, and requires typing TRANSFER. The password goes to Firebase Authentication only, not the Supabase function. The function requires a verified auth_time within five minutes; refreshing an old token without signing in again does not satisfy this check.
- The server rechecks both profiles and promotes the destination while demoting the caller in a single Firestore transaction. Both retain role Admin and their existing active status. Other main admins, if any, are unchanged. Concurrent changes to either profile cause transaction retries and permission checks. Administrative Auth deletion/disable performed directly in the Firebase console is outside that transaction and may still require manual recovery.
- Upon success, the former main admin loses Employee Accounts access and can return to Dashboard. The destination's sidebar link appears through its live permission listener (or after a reload). If a connection interrupts confirmation, verify the recipient's access before attempting another handover.

Test with an employee who has already completed password setup and signed in. First check a name/office edit, then try an incorrect main-admin password (no role change). For a real transfer, keep both accounts open in separate browser sessions, complete the confirmation, and verify the recipient gains Employee Accounts while the caller loses it. The new main admin can transfer back using the same flow. This hands over app permissions only, not ownership of Firebase, Supabase, Vercel or GitHub.

Firebase blocked template editing in this project; the user chose to retain the default password-reset email. No custom email provider or custom reset page has been added.
