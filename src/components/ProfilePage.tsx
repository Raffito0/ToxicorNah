import { User, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function ProfilePage() {
  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen bg-black px-5 pt-14 pb-24">
      <h1
        className="text-white text-2xl mb-6"
        style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
      >
        Profile
      </h1>

      {/* Placeholder profile */}
      <div className="flex flex-col items-center justify-center mt-12 text-center">
        <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4">
          <User size={32} className="text-white/30" />
        </div>
        <p
          className="text-white/50 text-base mb-8"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
        >
          Coming soon
        </p>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-white/80 transition-colors"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '14px' }}
        >
          <LogOut size={16} />
          Log out
        </button>
      </div>
    </div>
  );
}
