import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Plus, X, LogOut, MessageSquarePlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ImageCropModal } from './ImageCropModal';
import { AnimatePresence } from 'framer-motion';
import { startAnalysis } from '../services/analysisService';
import { getUserState, isFirstTimeUser, UserState } from '../services/userStateService';
import { injectContentScenario } from '../services/contentModeService';
import { ChatRenderer } from './content/ChatRenderer';
import { toPng } from 'html-to-image';
import type { ContentScenario } from '../types/contentScenario';
import { isDevMode } from '../utils/platform';

interface Person {
  id: string;
  name: string;
  avatar?: string;
}

interface UploadPageProps {
  onAnalyze: (analysisId: string) => void;
  contentScenario?: ContentScenario | null;
  isGuest?: boolean;
}

export function UploadPage({ onAnalyze, contentScenario, isGuest }: UploadPageProps) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isCreatingPerson, setIsCreatingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');
  const [showCropModal, setShowCropModal] = useState(false);
  const [tempFiles, setTempFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // User state for flow optimization
  const [userState, setUserState] = useState<UserState | null>(null);
  const [isLoadingState, setIsLoadingState] = useState(true);

  // Content mode state
  const chatRenderRef = useRef<HTMLDivElement>(null);
  const [contentScreenshots, setContentScreenshots] = useState<string[]>([]);
  const isContentMode = !!contentScenario;

  // Determine if this is a first-time user (skip crop modal + person selection)
  const isFirstTime = userState ? isFirstTimeUser(userState) : false;

  // Content mode: capture chat screenshot on mount
  useEffect(() => {
    if (!contentScenario) return;

    // Retry until the ref is available (may not be mounted on first render)
    let attempts = 0;
    const maxAttempts = 10;

    const tryCapture = async () => {
      attempts++;
      if (!chatRenderRef.current) {
        if (attempts < maxAttempts) {
          setTimeout(tryCapture, 300);
        } else {
          console.error('[ContentMode] chatRenderRef never mounted after', maxAttempts, 'attempts');
        }
        return;
      }

      try {
        // Capture the inner ChatRenderer element (has explicit 390x844 dimensions)
        // NOT the wrapper div which has opacity:0 that would be cloned by html-to-image
        const captureTarget = (chatRenderRef.current.firstElementChild as HTMLElement) || chatRenderRef.current;
        console.log('[ContentMode] Capture target dimensions:', captureTarget.offsetWidth, 'x', captureTarget.offsetHeight);
        const dataUrl = await toPng(captureTarget, {
          quality: 0.95,
          pixelRatio: 2,
          backgroundColor: '#000000',
          skipFonts: true,
        });
        setContentScreenshots([dataUrl]);
        console.log('[ContentMode] Chat screenshot captured on attempt', attempts);
      } catch (err) {
        console.error('[ContentMode] Failed to capture chat screenshot:', err);
      }
    };

    // Initial delay to let the chat render fully
    const timer = setTimeout(tryCapture, 800);
    return () => clearTimeout(timer);
  }, [contentScenario]);

  useEffect(() => {
    if (isContentMode) {
      setIsLoadingState(false);
      return;
    }
    loadUserState();
  }, [isContentMode]);

  useEffect(() => {
    // Only load persons if NOT first-time user
    if (userState && !isFirstTime) {
      loadPersons();
    }
  }, [userState, isFirstTime]);

  async function loadUserState() {
    try {
      const state = await getUserState();
      setUserState(state);
    } catch (error) {
      console.error('Error loading user state:', error);
    } finally {
      setIsLoadingState(false);
    }
  }

  async function loadPersons() {
    const { data, error } = await supabase
      .from('persons')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error loading persons:', error);
      return;
    }

    setPersons(data || []);
    if (data && data.length > 0 && !selectedPerson) {
      setSelectedPerson(data[0].id);
    }
  }

  async function createNewPerson() {
    if (!newPersonName.trim() || !selectedRelationship) return;

    const { data, error } = await supabase
      .from('persons')
      .insert({ name: newPersonName.trim(), user_id: null })
      .select()
      .single();

    if (error) {
      console.error('Error creating person:', error);
      return;
    }

    await loadPersons();
    setSelectedPerson(data.id);
    setNewPersonName('');
    setSelectedRelationship('');
    setIsCreatingPerson(false);
  }

  const relationships = ['Crush', 'Boyfriend / Girlfriend', 'Ex', 'Situationship', 'Friend', 'Family Member'];

  // Maximum number of screenshots allowed per analysis
  const MAX_SCREENSHOTS = 4;

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) {
      const remainingSlots = MAX_SCREENSHOTS - uploadedFiles.length;
      if (remainingSlots <= 0) {
        alert(`Maximum ${MAX_SCREENSHOTS} screenshots allowed per analysis`);
        return;
      }
      // Only take files up to the remaining slots
      const filesToProcess = Array.from(files).slice(0, remainingSlots);

      // FIRST-TIME USER: Skip crop modal, use files directly
      if (isFirstTime) {
        const newFiles = [...uploadedFiles, ...filesToProcess].slice(0, MAX_SCREENSHOTS);
        setUploadedFiles(newFiles);
      } else {
        setTempFiles(filesToProcess);
        setShowCropModal(true);
      }
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      const remainingSlots = MAX_SCREENSHOTS - uploadedFiles.length;
      if (remainingSlots <= 0) {
        alert(`Maximum ${MAX_SCREENSHOTS} screenshots allowed per analysis`);
        return;
      }
      // Only take files up to the remaining slots
      const filesToProcess = Array.from(files).slice(0, remainingSlots);

      // FIRST-TIME USER: Skip crop modal, use files directly
      if (isFirstTime) {
        const newFiles = [...uploadedFiles, ...filesToProcess].slice(0, MAX_SCREENSHOTS);
        setUploadedFiles(newFiles);
      } else {
        setTempFiles(filesToProcess);
        setShowCropModal(true);
      }
    }
  }

  function handleCropConfirm(croppedFiles: File[]) {
    // Ensure we don't exceed the max
    const newFiles = [...uploadedFiles, ...croppedFiles].slice(0, MAX_SCREENSHOTS);
    setUploadedFiles(newFiles);
    setShowCropModal(false);
    setTempFiles([]);
  }

  function handleCropCancel() {
    setShowCropModal(false);
    setTempFiles([]);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  async function handleAnalyze() {
    // CONTENT MODE: inject scenario results directly
    if (isContentMode && contentScenario) {
      console.log('[ContentMode] Injecting scenario results...');
      const analysisId = injectContentScenario(contentScenario);
      console.log('[ContentMode] Analysis ID:', analysisId);
      onAnalyze(analysisId);
      return;
    }

    // For first-time users, we don't require person selection
    if (!isFirstTime && !selectedPerson) {
      console.log('Cannot analyze: no person selected');
      return;
    }

    if (uploadedFiles.length === 0) {
      console.log('Cannot analyze: no files uploaded');
      return;
    }

    console.log('Starting analysis...', { selectedPerson, uploadedFilesCount: uploadedFiles.length, isFirstTime });

    try {
      let personIdToUse = selectedPerson;

      // FIRST-TIME USER: Auto-create a default person "Him"
      if (isFirstTime && !selectedPerson) {
        console.log('First-time user: auto-creating default person "Him"');

        // Check if we're in dev mode
        const isDev = isDevMode();

        const { data: newPerson, error: createError } = await supabase
          .from('persons')
          .insert({ name: 'Him', user_id: null })
          .select()
          .single();

        if (createError) {
          console.error('Error creating default person:', createError);
          // Fallback to localStorage mode (works in both dev and production)
          console.log('Supabase unavailable, using localStorage mode');
          personIdToUse = 'dev-person-' + Date.now();
        } else {
          personIdToUse = newPerson.id;
        }
        console.log('Person ID to use:', personIdToUse);
      }

      // Use startAnalysis for immediate navigation (progressive loading)
      const analysisId = await startAnalysis(personIdToUse, uploadedFiles);
      console.log('Analysis started, ID:', analysisId, '- navigating immediately');
      onAnalyze(analysisId);
    } catch (error) {
      console.error('Error processing analysis:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
      alert(`Failed to analyze chat: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
    }
  }

  const selectedPersonData = persons.find(p => p.id === selectedPerson);
  const selectedPersonName = selectedPersonData?.name || 'Select a person';

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="h-screen bg-black text-white overflow-hidden flex flex-col">
      <div className="flex flex-col items-center flex-1 min-h-0" style={{ paddingLeft: '30px', paddingRight: '30px', paddingTop: '16px', paddingBottom: '16px' }}>
        <div className="w-full max-w-md flex flex-col flex-1 min-h-0">
          <div className="bg-black pt-12 pb-4 flex flex-col flex-1 min-h-0">
            <div className="text-center mb-8">
              <div className="flex items-center justify-center gap-3 mb-2 relative">
                <img
                  src="/logo-group59.png"
                  alt="Toxic or Nah Logo"
                  style={{ height: '38px' }}
                />
                {!isGuest && !isContentMode && (
                  <button
                    onClick={handleLogout}
                    className="absolute right-0 text-zinc-400 hover:text-white transition-colors p-2"
                    title="Logout"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            <div
              className={`rounded-3xl cursor-pointer transition-all flex items-center justify-center ${
                (isContentMode && contentScreenshots.length > 0)
                  ? 'flex-1 min-h-0 mb-4 max-h-[60vh]'
                  : 'aspect-square mb-10'
              }`}
              style={{ backgroundColor: '#121212' }}
              onClick={() => !isContentMode && fileInputRef.current?.click()}
              onDrop={!isContentMode ? handleDrop : undefined}
              onDragOver={!isContentMode ? handleDragOver : undefined}
            >
          {/* CONTENT MODE: Show captured chat screenshot */}
          {isContentMode && contentScreenshots.length > 0 ? (
            <div className="w-full h-full flex items-center justify-center px-5 py-8 overflow-hidden">
              {contentScreenshots.map((dataUrl, index) => (
                <img
                  key={index}
                  src={dataUrl}
                  alt={`Chat ${index + 1}`}
                  className="max-w-full max-h-full object-contain rounded-lg"
                />
              ))}
            </div>
          ) : isContentMode ? (
            <div className="flex flex-col items-center justify-center p-8">
              <div className="w-8 h-8 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-zinc-400 text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                Generating chat preview...
              </p>
            </div>
          ) : uploadedFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8">
              <MessageSquarePlus className="w-16 h-16 mb-4 text-zinc-500" strokeWidth={1.5} />
              <h3 className="text-white text-lg mb-2" style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 500, letterSpacing: '1.5px' }}>
                Upload your chats
              </h3>
              <p className="text-zinc-400 text-sm text-center" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                You can choose to upload 1 or<br />more chat screenshots
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-4">
              <div className="flex flex-wrap gap-2 items-center justify-center">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`Upload ${index + 1}`}
                      className="h-24 w-auto object-cover rounded-lg"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedFiles(uploadedFiles.filter((_, i) => i !== index));
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-zinc-400 text-sm mt-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                {uploadedFiles.length} chat{uploadedFiles.length > 1 ? 's' : ''} uploaded
              </p>
            </div>
          )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* PERSON SELECTION - Hidden for first-time users and content mode */}
            {!isContentMode && !isFirstTime && (
              <div className="mb-6">
                <label className="text-white text-base mb-3 block" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                  Select the person you want to analyze:
                </label>

                <div className="relative mb-3">
                  <button
                    onClick={() => {
                      console.log('Dropdown clicked. Current state:', isDropdownOpen);
                      console.log('Persons available:', persons.length);
                      setIsDropdownOpen(!isDropdownOpen);
                    }}
                    className="w-full bg-white text-black rounded-full px-5 flex items-center justify-between hover:bg-gray-100 transition-colors text-base"
                    style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', height: '40px' }}
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={selectedPersonData?.avatar || '/Senza titolo.jpg'}
                        alt={selectedPersonName}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                      <span className="font-medium">{selectedPersonName}</span>
                    </div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden z-50 shadow-xl">
                      {persons.filter(p => p.id !== selectedPerson).length === 0 ? (
                        <div className="px-5 py-3 text-zinc-400 text-center">
                          No other people available
                        </div>
                      ) : (
                        persons.filter(p => p.id !== selectedPerson).map((person) => (
                          <button
                            key={person.id}
                            onClick={() => {
                              setSelectedPerson(person.id);
                              setIsDropdownOpen(false);
                            }}
                            className="w-full px-5 py-3 text-left hover:bg-zinc-800 transition-colors text-white flex items-center gap-3"
                            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                          >
                            <img
                              src={person.avatar || '/Senza titolo.jpg'}
                              alt={person.name}
                              className="w-6 h-6 rounded-full object-cover"
                            />
                            {person.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setIsCreatingPerson(!isCreatingPerson)}
                  className="w-full border border-zinc-700 rounded-full px-5 flex items-center justify-between hover:border-zinc-600 hover:bg-zinc-900/30 transition-colors text-base"
                  style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', height: '40px' }}
                >
                  <span className="text-zinc-400">Create new person</span>
                  <Plus className={`w-5 h-5 text-zinc-400 transition-transform duration-300 ${isCreatingPerson ? 'rotate-45' : ''}`} />
                </button>

                <div
                  className="overflow-hidden transition-all duration-300 ease-in-out"
                  style={{
                    maxHeight: isCreatingPerson ? '400px' : '0',
                    opacity: isCreatingPerson ? 1 : 0,
                    marginTop: isCreatingPerson ? '12px' : '0'
                  }}
                >
                  <div className="border border-zinc-700 rounded-3xl p-5 bg-black">
                    <div className="flex items-center justify-between mb-4">
                      <input
                        type="text"
                        value={newPersonName}
                        onChange={(e) => setNewPersonName(e.target.value)}
                        placeholder="Enter name"
                        className="flex-1 bg-transparent text-white placeholder-zinc-500 focus:outline-none text-base font-medium"
                        style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setIsCreatingPerson(false);
                            setNewPersonName('');
                            setSelectedRelationship('');
                          }
                        }}
                      />
                    </div>

                    <div className="border-t border-zinc-800 pt-4">
                      <p className="text-zinc-400 text-sm mb-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
                        Is {newPersonName || 'this person'} your:
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {relationships.map((relationship) => (
                          <button
                            key={relationship}
                            onClick={() => setSelectedRelationship(relationship)}
                            className={`rounded-2xl text-sm font-medium transition-colors ${
                              selectedRelationship === relationship
                                ? 'bg-zinc-700 text-white'
                                : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                            }`}
                            style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', paddingTop: '10px', paddingBottom: '10px', paddingLeft: '15px', paddingRight: '15px', fontSize: '14px' }}
                          >
                            {relationship}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={isContentMode ? contentScreenshots.length === 0 : ((!isFirstTime && !selectedPerson) || uploadedFiles.length === 0 || isLoadingState)}
              className="w-full text-white rounded-full px-6 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-base"
              style={{
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                fontWeight: 400,
                letterSpacing: '1.5px',
                height: '48px',
                fontSize: '15px',
                background: '#7200B4'
              }}
            >
              READ HIM
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showCropModal && (
          <ImageCropModal
            selectedFiles={tempFiles}
            onConfirm={handleCropConfirm}
            onCancel={handleCropCancel}
          />
        )}
      </AnimatePresence>

      {/* Hidden chat renderer for content mode screenshot capture */}
      {isContentMode && contentScenario && (
        <div
          ref={chatRenderRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            opacity: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          <ChatRenderer
            appStyle={contentScenario.chat.appStyle}
            contactName={contentScenario.chat.contactName}
            messages={contentScenario.chat.messages}
          />
        </div>
      )}
    </div>
  );
}
