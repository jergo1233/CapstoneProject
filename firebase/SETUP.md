# Firebase authentication foundation

The authentication code is connected to the Firebase SDK, but requires a real project configuration and published rules. Reports and analytics still use prototype data. Announcements are connected to Firestore with optional Supabase Storage images. Publish the updated rules before testing; report access remains denied.

1. Create or select a Firebase project and register a Web app. Copy its public configuration into `firebase/config.js`. Never use a service-account key in browser code.
2. Enable Authentication > Sign-in method > Email/Password. Check Authentication authorized domains for your development and deployment hosts.
3. Create the default Cloud Firestore database. Review and publish `firestore.rules` in its Rules tab. These rules permit resident profile creation and owner/admin reads; clients cannot grant admin access.
4. Serve the repository through a local HTTP server (for example your editor's Live Server). Open `register.html`, register, and verify that Authentication contains the user and `residents/{uid}` contains the profile with no password field.
5. Test resident login and sign-out. To designate an admin, create their user in Firebase Authentication, then manually create `admins/{their-auth-uid}` with `fullName`, `emailAddress`, `officeName`, `role: "Admin"`, and `dateCreated` (Timestamp). Test their login at `admin_interface/admin_login/admin.html`. An ordinary resident must fail admin login.
6. Test access rules using Firebase's Rules Playground or Emulator: another resident cannot read a profile; a client cannot create an admin; an unsigned user cannot read profiles; report and storage access remains denied.

Firebase Storage has been replaced by Supabase image storage. Follow `supabase/SETUP.md` for its policy and Edge Function deployment. Do not replace existing deployed rules without reviewing how they affect other applications using the same Firebase project.

Registration attempts to remove a newly created Authentication account if profile creation fails. If cleanup also fails, the UI asks for administrator assistance. No cloud resources, packages, accounts, rules, commits or deployments are created automatically by this local setup.

SDK reference: https://firebase.google.com/docs/web/alt-setup
Authentication reference: https://firebase.google.com/docs/auth/web/start

## Announcement integration testing

1. Publish the current `firestore.rules` in Cloud Firestore. Announcements are public-readable; only designated admins can create/delete them. Resident/admin profile rules remain in place.
2. Sign in at the admin login and open Announcement. Create a text-only announcement. Verify `announcements/{id}` contains `authorID`, `title`, `content`, and `datePosted`.
3. In a resident browser session, open Announcement and Home. Confirm the real title/content appears and newly posted items update without refreshing. Delete a test announcement as admin and confirm removal on both sides.
4. For image testing, complete `supabase/SETUP.md`: apply bucket SQL, deploy the image-storage Edge Function, and publish the current Firestore rules. Firebase Blaze is not needed for this architecture.
5. Post one JPEG, PNG or WebP image up to 5 MB and confirm it displays on both sides. Images are public announcement assets. Private report images must not use this public URL flow.
6. Verify non-admin announcement writes fail using Rules Playground or the Emulator. Client checks alone are not authorization. Rules have not yet been compiled/tested in an emulator in this workspace.
7. Test failed uploads and saves: the form keeps entered text and shows an error. Deletion removes the document first; failed image cleanup is reported for manual Storage cleanup.

Offline persistence across page reloads is not implemented. The listener can retain already loaded announcements on the current page during a temporary connection failure. Reports, priority/routing workflows and analytics are the next implementation stage.
