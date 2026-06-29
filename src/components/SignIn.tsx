import React from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function SignIn() {
  const signInWithGoogle = () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#0A0F0D] text-white">
      <button 
        onClick={signInWithGoogle}
        className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-bold py-2 px-4 rounded"
      >
        Sign in with Google
      </button>
    </div>
  );
}
