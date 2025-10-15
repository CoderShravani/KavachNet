// This file initializes the Firebase client SDK and connects to emulators for local development.

import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { firebaseConfig } from "./firebaseConfig.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// Connect to emulators if running locally (highly recommended for development)
// Ensure your firebase.json is configured to use these ports.
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  console.log("KavachNet is running in development mode. Connecting to Firebase emulators...");
  
  // Point auth to the emulator
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  
  // Point firestore to the emulator
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  
  // Point storage to the emulator
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  
  // Point functions to the emulator
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export { auth, db, storage, functions };