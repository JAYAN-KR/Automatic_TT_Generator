import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyCx_Yfl3jvtLMhhU_PTpqZBMbH1a2SKaZk",
    authDomain: "substitution-app.firebaseapp.com",
    projectId: "substitution-app",
    storageBucket: "substitution-app.firebasestorage.app",
    messagingSenderId: "726661871630",
    appId: "1:726661871630:web:8feffede4fad16e3a6645f",
    measurementId: "G-ZQWRNPJHTL",
    databaseURL: "https://substitution-app-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Singleton initialization pattern to prevent "Duplicate App" errors
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export { app };
