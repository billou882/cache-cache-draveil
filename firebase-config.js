import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcxudeQK91giQA5kzSa6wnFzZJIgODjq8",
  authDomain: "cache-cache-draveil.firebaseapp.com",
  databaseURL: "https://cache-cache-draveil-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cache-cache-draveil",
  storageBucket: "cache-cache-draveil.firebasestorage.app",
  messagingSenderId: "809078029731",
  appId: "1:809078029731:web:83e384a38ce01254016e16"
};

const firebaseApp = initializeApp(firebaseConfig);

export const db = getDatabase(firebaseApp);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);

export async function connectFirebase() {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  const credential = await signInAnonymously(auth);
  return credential.user;
}
