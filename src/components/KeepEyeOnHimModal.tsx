import { useState, useRef, useEffect } from 'react';
import { Camera, User, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RELATIONSHIP_STATUS_OPTIONS, RelationshipStatus, updatePersonName, updateRelationshipStatus, updatePersonAvatar } from '../services/personProfileService';
import { supabase } from '../lib/supabase';
import { isDevMode } from '../utils/platform';

interface KeepEyeOnHimModalProps {
  isOpen: boolean;
  analysisId: string;
  personGender: 'male' | 'female';
  canSkip: boolean;
  onSaved: () => void;
  onSkip: () => void;
}

export function KeepEyeOnHimModal({
  isOpen,
  analysisId,
  personGender,
  canSkip,
  onSaved,
  onSkip,
}: KeepEyeOnHimModalProps) {
  const [name, setName] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState<RelationshipStatus>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const pronoun = personGender === 'female' ? 'her' : 'him';
  const pronounSubj = personGender === 'female' ? 'she' : 'he';
  const displayName = name.trim() || (personGender === 'female' ? 'Her' : 'Him');

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  }

  async function handleSave() {
    if (!name.trim() || !selectedRelationship || isSaving) return;
    setIsSaving(true);

    try {
      // Look up person_id from analysis
      let personId: string | null = null;

      if (!analysisId.startsWith('dev-analysis-')) {
        const { data: analysis } = await supabase
          .from('analysis_results')
          .select('person_id')
          .eq('id', analysisId)
          .single();
        personId = analysis?.person_id || null;
      }

      if (personId) {
        // Update person name
        await updatePersonName(personId, name.trim());

        // Update relationship status
        await updateRelationshipStatus(personId, selectedRelationship);

        // Upload avatar if provided
        if (avatarFile) {
          try {
            const ext = avatarFile.name.split('.').pop() || 'jpg';
            const fileName = `${personId}.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(fileName, avatarFile, { upsert: true });

            if (!uploadError) {
              const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(fileName);
              await updatePersonAvatar(personId, publicUrl);
            }
          } catch (avatarErr) {
            console.warn('Avatar upload failed (storage may not be configured):', avatarErr);
          }
        }
      } else if (isDevMode()) {
        console.log('[DEV] Would save person:', { name: name.trim(), relationship: selectedRelationship, hasAvatar: !!avatarFile });
      }

      setShowSuccess(true);
      setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onSaved(), 400);
      }, 1200);
    } catch (err) {
      console.error('Error saving person details:', err);
      setShowSuccess(true);
      setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onSaved(), 400);
      }, 1200);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto" style={{ paddingTop: '40px', paddingBottom: '40px' }}>
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: isExiting ? 0 : 1, backdropFilter: isExiting ? 'blur(0px)' : 'blur(16px)' }}
          transition={{ duration: 0.35 }}
          className="absolute inset-0 bg-black/70"
          style={{ WebkitBackdropFilter: isExiting ? 'blur(0px)' : 'blur(16px)' }}
        />

        {/* Modal — no border */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          animate={{
            opacity: isExiting ? 0 : 1,
            scale: isExiting ? 0.9 : 1,
            filter: isExiting ? 'blur(10px)' : 'blur(0px)',
          }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="relative w-full max-w-md bg-[#0a0a0a] rounded-[32px] mx-4"
        >
          <div className="px-6 py-8 relative overflow-hidden">
            {/* Success overlay */}
            <AnimatePresence>
              {showSuccess && (
                <motion.div
                  className="absolute inset-0 flex flex-col items-center justify-center z-20"
                  initial={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.4, delay: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                    style={{ background: '#7200B4' }}
                  >
                    <Check className="w-8 h-8 text-white" strokeWidth={2.5} />
                  </div>
                  <p
                    className="text-white text-xl"
                    style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
                  >
                    You added {displayName}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form content — blurs in on mount, blurs out on success */}
            <motion.div
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{
                filter: showSuccess ? 'blur(12px)' : 'blur(0px)',
                opacity: showSuccess ? 0 : 1,
              }}
              transition={{ duration: 0.4 }}
            >
            {/* Avatar upload circle — NO overflow:hidden so camera badge can protrude */}
            <div className="flex justify-center mb-6">
              <div
                className="relative w-24 h-24 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                {/* Avatar circle */}
                <div className="w-full h-full rounded-full bg-zinc-800/60 flex items-center justify-center overflow-hidden border-2 border-zinc-700">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-10 h-10 text-zinc-500" />
                  )}
                </div>
                {/* Camera badge — positioned outside the clipping circle */}
                <div className="absolute -bottom-1 -right-1 w-9 h-9 bg-[#7200B4] rounded-full flex items-center justify-center border-[3px] border-[#0a0a0a]">
                  <Camera className="w-4 h-4 text-white" />
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarSelect}
                className="hidden"
              />
            </div>

            {/* Title */}
            <h2
              className="text-white text-center text-2xl mb-2"
              style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}
            >
              Keep an eye on {pronoun}
            </h2>

            {/* Subtitle */}
            <p
              className="text-center text-white/50 mb-8"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', fontSize: '14px' }}
            >
              With every chat, we reveal more of who {pronounSubj} really is
            </p>

            {/* Name + Relationship form */}
            <div className="border border-zinc-700 rounded-3xl p-5 bg-black mb-6">
              <div className="mb-4">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter name"
                  className="w-full bg-transparent text-white placeholder-zinc-500 focus:outline-none text-base font-medium"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                />
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <p
                  className="text-zinc-400 text-sm mb-4"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                >
                  What's going on with {pronoun}?
                </p>
                <div className="flex flex-wrap gap-3">
                  {RELATIONSHIP_STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setSelectedRelationship(option.value)}
                      className="rounded-2xl text-sm font-medium transition-colors"
                      style={{
                        background: selectedRelationship === option.value ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                        color: selectedRelationship === option.value ? '#FFFFFF' : 'rgba(255, 255, 255, 0.35)',
                        fontFamily: 'Plus Jakarta Sans, sans-serif',
                        fontWeight: 200,
                        letterSpacing: '1.5px',
                        paddingTop: '10px',
                        paddingBottom: '10px',
                        paddingLeft: '15px',
                        paddingRight: '15px',
                        fontSize: '14px',
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        <img src={option.icon} alt="" className="w-5 h-5" style={{ opacity: selectedRelationship === option.value ? 1 : 0.5 }} />
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* CTA Button — "ADD {name}" */}
            <button
              onClick={handleSave}
              disabled={!name.trim() || !selectedRelationship || isSaving}
              className="w-full text-white rounded-full px-6 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed uppercase"
              style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontWeight: 400,
                letterSpacing: '1.5px',
                height: '48px',
                fontSize: '15px',
                background: '#7200B4',
              }}
            >
              {isSaving ? 'Saving...' : `ADD ${displayName.toUpperCase()}`}
            </button>

            {/* Not now link (only when canSkip) */}
            {canSkip && (
              <button
                onClick={onSkip}
                className="w-full text-center mt-4 text-white/40 hover:text-white/60 transition-colors"
                style={{
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 200,
                  letterSpacing: '1.5px',
                  fontSize: '14px',
                }}
              >
                Not now
              </button>
            )}
            </motion.div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
