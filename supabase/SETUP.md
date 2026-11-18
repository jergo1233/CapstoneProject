# Supabase image storage with Firebase accounts

Announcement images were deployed and tested by the project owner. Private report-photo support is now prepared locally and requires redeploying the same function and publishing the updated Firestore rules.

## What runs where

- Firebase Authentication continues handling accounts/passwords.
- Firestore remains the source for admin roles, reports and announcement records.
- Supabase stores image bytes. The browser contains only the project URL and publishable key.
- A small Supabase Edge Function named `image-storage` verifies the caller using Firebase Auth's `accounts:lookup` endpoint, reads `admins/{uid}` through Firestore using the same Firebase token, and requires `role == 'Admin'` for announcement operations. Report-photo operations check the saved report through Firestore with the caller’s token, enforcing owner/admin read access.
- The function uses the server-only `SUPABASE_SERVICE_ROLE_KEY` supplied by Supabase. It never returns that key. No Firebase service-account key, custom claims, copied admin list, new user provisioning hook, or Firebase Cloud Function is required.
- The previously enabled Firebase third-party provider can remain enabled, but this server-mediated implementation does not depend on it. Direct Storage operations using Firebase tokens are deliberately blocked by SQL policy.

This small server-side component is needed because Supabase's storage policies cannot directly read our current Firestore admin records. Supabase's Free plan includes Edge Function usage, subject to its current quotas; Firebase Blaze is not required for this architecture. Each announcement operation performs a Firebase Auth lookup and a Firestore admin read. Report downloads check Auth and the report; report uploads also check the owner’s resident profile.

## 1. Apply bucket settings and access policy

In the Supabase project `lpcmwrdizcistkxylsps`, open **SQL Editor → New query**. Paste all of `supabase/storage-policies.sql`, review it, and run it.

The SQL updates only `announcement-images` and `report-images` bucket settings and the named `capstone_images_server_only` policy. It sets 5 MB JPEG/PNG/WebP limits, keeps announcements public and reports private, and blocks direct browser operations on both buckets. It does not delete image files or create user accounts. It is safe to rerun for this setup.

Public URLs bypass read policies for the public announcement bucket, as intended. Never put report photos into that bucket. Do not add permissive browser upload policies to work around a failed function deployment.

## 2. Deploy the server function

In Supabase **Edge Functions**, create/deploy a function using the dashboard editor and name it exactly **`image-storage`**. Replace its starter `index.ts` with the complete contents of `supabase/functions/image-storage/index.ts`. It is self-contained: no extra files, packages, or imports are required.

Set this function's platform **Verify JWT** / **Verify JWT with legacy secret** option to **off** (`verify_jwt = false`). This disables the legacy *Supabase* JWT gate, not our authentication: the function rejects requests unless Firebase verifies the token and Firestore confirms current access for the requested operation. Without this setting, the gateway may reject Firebase tokens before our function can check them. Leave other functions' settings alone.

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside hosted Edge Functions. Do not paste the service-role key, secret key, or database password into browser files or chat. The Firebase project ID and public API key are already included in the function.

An optional CLI equivalent, if the CLI is already installed and authenticated, is:

```sh
supabase functions deploy image-storage --project-ref lpcmwrdizcistkxylsps
```

The checked-in `supabase/config.toml` sets `verify_jwt = false`. No deployment has been run by the coding assistant.

## 3. Publish the updated Firestore rules

In Firebase's **Cloud Firestore → Rules**, publish the complete local `firestore.rules`.

The announcement image URL must now point to this project's `announcement-images/{announcementId}/image`. This replaces the previous Firebase Storage URL validation. Text-only posts still work. Existing announcement records remain readable; deleting a record with an older image URL reports that manual image cleanup is needed.

Firebase Storage is no longer initialized in the browser or included in `firebase.json` deployment configuration. The local `storage.rules` now denies all Firebase Storage access; there is no need to enable Firebase Storage or upgrade billing.

## 4. Test online

1. Sign in as the designated admin and create a text-only announcement.
2. Create one with a small PNG/JPEG/WebP. Confirm its file appears under `announcement-images/{id}/image` and the Firestore record contains the matching public URL.
3. Open the resident Announcement page and Home. Confirm the image and text load.
4. Delete the test announcement; confirm the record and its stored image disappear. Cached public images may remain temporarily visible in browsers/CDNs after deletion.
5. Use a resident-only test account to attempt an announcement-image function call: it must return 403, not upload or delete. A missing/invalid Firebase token must return 401. A public publishable key alone must never grant uploads.
6. Removing the test account's admin profile must deny the next image operation. A request already authorized and in flight may still finish. Restore the designated test profile manually if needed afterward.
7. `report-images` must reject anonymous/public downloads and direct client uploads. Report photos are served only through authenticated Edge Function requests.

The dashboard's generic function test tool does not automatically provide a Firebase ID token. Test through the app for the normal authenticated path; don't paste live tokens into chat or logs.

## Error handling and limits

- The form keeps entered text on an upload/save failure.
- Successful uploads followed by a rejected Firestore save trigger image cleanup. A failed cleanup or an interrupted browser/network request may leave an orphan image for manual cleanup; two independent services cannot share one atomic transaction.
- Deletion removes the announcement record first, then its image. Failed image cleanup is reported without falsely claiming the announcement deletion failed.
- The server enforces maximum size and basic image signatures as well as MIME types. Uploads never overwrite an existing object.
- Firebase/Auth/Firestore outages fail closed. An outage is not treated as admin permission.
- No persistent offline cache is used for private report photos.

## Local checks

With Node 22.18+ (Node 26 used here):

```sh
node tests/image-storage.test.mjs
```

The tests exercise the exact exported server handler with simulated Firebase/Storage responses. They cover authorization rejection, current admin revocation, bucket/path restrictions, size/type limits, CORS, deletion targeting and safe failures. They do not replace real Firebase/Supabase tests. The owner previously ran the SQL and tested announcement deployment. The new report-photo route still needs hosted deployment and browser verification.

## References

- Firebase account lookup: https://firebase.google.com/docs/reference/rest/auth
- Firestore REST requests with Firebase ID tokens obey rules: https://firebase.google.com/docs/firestore/use-rest-api
- Supabase function configuration: https://supabase.com/docs/guides/functions/function-configuration
- Server-only environment keys: https://supabase.com/docs/guides/functions/secrets
- Storage access controls: https://supabase.com/docs/guides/storage/security/access-control
- Free plan quotas: https://supabase.com/pricing

## Update the existing project for private report photos

1. In Supabase → Edge Functions → **image-storage**, replace its `index.ts` with the complete current `supabase/functions/image-storage/index.ts`, then deploy/update that same function. It remains self-contained.
2. Keep **Verify JWT with legacy secret** off as before; the handler verifies Firebase itself. No new secrets are needed.
3. Keep `report-images` **private**. The previously applied `storage-policies.sql` already permits this server-mediated workflow, so no SQL change or additional Storage policy is needed.
4. In Firebase → Firestore Database → Rules, publish the current root `firestore.rules`.
5. Reload the local app and follow the report-photo checks in `tests/README.md`.

### Report-photo contract

- One optional JPEG/PNG/WebP, up to 5 MB. Firestore reserves `supportingImageURL = {ownerUid}/{reportId}/image` when creating the report. Despite the existing field name, this is a private object reference, never a public or signed URL.
- Save the report first, then upload using `POST image-storage?kind=report&id={reportId}`. Only the report owner with a resident profile can upload. The server derives the bucket/path and refuses overwrites.
- An upload failure returns a **report saved, photo not confirmed** result. Do not submit another report. Open its details, try loading the photo (the upload may already have succeeded), and if it is missing, select the file again to retry that existing report.
- `GET` on the same route verifies Firebase and the current Firestore report-read permission, then streams bounded image bytes with `Cache-Control: no-store`. No public/signed link is returned.
- Viewers use temporary object URLs; closing details, changing account or known access revocation clears them. Already viewed/downloaded content cannot be recalled from a person who was authorized to receive it.
- Reports without a reserved photo reference continue to work. Adding a photo to an older text-only report, replacing/deleting a submitted photo, and report deletion are not enabled.
- A missing photo does not mean the report failed. The report can still be reviewed and processed. If a project owner manually deletes a report in the console during an upload, manual bucket cleanup may be needed; Firestore and Storage cannot share one transaction.

Local checks: `node tests/report-images.test.mjs`, `node tests/report-photo-viewer.test.mjs`, and the existing suites. Tests mock hosted services; perform the live two-account check after deployment.

Private download endpoint reference: https://supabase.com/docs/guides/storage/serving/downloads
