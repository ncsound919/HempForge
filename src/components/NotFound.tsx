import React from 'react';
import { motion } from 'motion/react';
import { FileQuestion, Home } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[70vh] text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center"
      >
        <FileQuestion className="w-24 h-24 text-slate-600 mb-6" />
        <h1 className="text-4xl font-bold text-slate-200 mb-4 tracking-tight">404 - Not Found</h1>
        <p className="text-slate-400 max-w-md mb-8 text-lg">
          The requested resource or pathway could not be located in the system ledger.
        </p>
        <Link 
          to="/" 
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          <Home className="w-5 h-5" />
          Return to Dashboard
        </Link>
      </motion.div>
    </div>
  );
}
