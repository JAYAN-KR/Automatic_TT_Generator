import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyDwKMM0tYbvG6Y_n_HAJRIGCqApiFrG-JI",
    authDomain: "automatic-tt-generator.firebaseapp.com",
    projectId: "automatic-tt-generator",
    storageBucket: "automatic-tt-generator.firebasestorage.app",
    messagingSenderId: "480947809023",
    appId: "1:480947809023:web:a257e8e1e7ff198c5b3aca"
};

// Singleton initialization with a UNIQUE NAME to avoid conflicts with other projects
const app = getApps().find(a => a.name === 'timetableApp')
    || initializeApp(firebaseConfig, 'timetableApp');

export const db = getFirestore(app);
export const auth = getAuth(app);
export { app };
