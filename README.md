# TFC Bandiyod — Member Portal (starter build)

## What is implemented
- English / Malayalam switch, mobile responsive interface
- Google sign-in with Firebase Authentication
- Admin-approved member access and member-number linking
- Admin approval queue and private member list
- Member payment-history view (only admin-verified payment entries)
- ₹50 monthly / ₹600 yearly membership model

## Important: Not yet a deployed or complete production website
- Configure Firebase `firebase-config.js` with your project's web-app config.
- Enable Google sign-in in Firebase Authentication (already enabled in your project).
- Add the hosting domain to Firebase Authentication > Settings > Authorized domains.
- Publish `database.rules.json` as Realtime Database Rules (paste its JSON into the Rules editor).
- Bootstrap the admin manually in Realtime Database **Data**: `admins/YOUR_ADMIN_FIREBASE_AUTH_UID = true`. Obtain the UID from Authentication > Users for `bandiyodtfc@gmail.com`. The admin email by itself does NOT grant privileges.
- Import `members-import.json` **privately** into `/members` using an admin-only process; do not upload it to the public website. The file is an initial extracted roster and requires checking against the original PDF for duplicate/incorrect names and numbers.
- The PDF's 2024–2026 month checkmarks need manual verification, especially pages with two membership cards or incomplete formatting. No payment history has been assumed or automatically certified.
- Add UPI ID later. Payment confirmation, receipt uploading, admin verification and financial ledger still require implementation; the payment button is intentionally disabled.
- Publish the website on Firebase Hosting or another HTTPS host. Do not publish the private roster JSON.

## Security
Firebase rules enforce admin access and approved-member access. Do not make `.read` or `.write` globally true. Keep member phone numbers and the import JSON out of public hosting.

## Local development
Use a local HTTP server (not file://) to serve `index.html`. Firebase config is a public client config, not a secret; security depends on database rules and authentication.
