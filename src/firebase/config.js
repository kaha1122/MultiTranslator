import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
    apiKey: "AIzaSyCBVNz83WGSbQhcU8ckoK1s72uA5H4s77k",
    authDomain: "trnaslatorapp.firebaseapp.com",
    projectId: "trnaslatorapp",
    storageBucket: "trnaslatorapp.firebasestorage.app",
    messagingSenderId: "879220793558",
    appId: "1:879220793558:web:e5502387022a07cb53e977",
    measurementId: "G-4LEJKMXQHJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

export default app;
