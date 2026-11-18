import { cert, initializeApp } from 'npm:firebase-admin@13.5.0/app';
import { getAuth } from 'npm:firebase-admin@13.5.0/auth';
import { initializeFirestore, FieldPath, FieldValue } from 'npm:firebase-admin@13.5.0/firestore';
import { createEmployeeHandler } from './handler.mjs';

// Store this JSON only in Supabase server secrets, never in this directory.
const credentials = JSON.parse(Deno.env.get('EMPLOYEE_FIREBASE_SERVICE_ACCOUNT') || '{}');
if (credentials.project_id !== 'capstone-reporting-system') throw new Error('Employee service Firebase project configuration is invalid.');
const app = initializeApp({ credential: cert(credentials) });
// REST avoids a native gRPC dependency in the edge runtime.
const db = initializeFirestore(app, { preferRest: true });
const apiKey = Deno.env.get('EMPLOYEE_FIREBASE_WEB_API_KEY');
if (!apiKey) throw new Error('Employee service API configuration is missing.');
Deno.serve(createEmployeeHandler({
    auth: getAuth(app), db, timestamp: () => FieldValue.serverTimestamp(), documentId: () => FieldPath.documentId(),
    async sendSetupEmail(email) {
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Setup email could not be sent.');
    },
}));
