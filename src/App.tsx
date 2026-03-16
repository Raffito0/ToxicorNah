import { useState, useEffect } from 'react';
import { AuthPage } from './components/AuthPage';
import { UploadPage } from './components/UploadPage';
import { ResultsPage } from './components/ResultsPage';
import { ConnectionsPage } from './components/ConnectionsPage';
import { PersonProfile } from './components/PersonProfile';
import { SoulPage } from './components/SoulPage';
import { PaymentSuccessPage } from './components/PaymentSuccessPage';
import { ShareLandingPage } from './components/ShareLandingPage';
import { BottomNav, TabId } from './components/BottomNav';
import { supabase } from './lib/supabase';
import { loadScenario, loadScenarioFromSupabase } from './services/contentModeService';
import { initPurchases } from './services/purchaseService';
import type { ContentScenario } from './types/contentScenario';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('analyze');
  const [analyzeSubPage, setAnalyzeSubPage] = useState<'upload' | 'results'>('upload');
  const [currentAnalysisId, setCurrentAnalysisId] = useState<string>('');
  const [connectionsSubPage, setConnectionsSubPage] = useState<'list' | 'profile'>('list');
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [contentScenario, setContentScenario] = useState<ContentScenario | null>(null);
  const [guestMode, setGuestMode] = useState(false);

  useEffect(() => {
    // Initialize in-app purchases (no-op on web, sets up StoreKit on iOS)
    initPurchases().catch(console.error);

    // Handle App Link sid injected by Android MainActivity
    const handleApplinkSid = (e: Event) => {
      const sid = (e as CustomEvent).detail as string;
      if (sid) {
        loadScenarioFromSupabase(sid)
          .then(setContentScenario)
          .catch((err) => console.error('[AppLink] Failed to load scenario:', err));
      }
    };
    window.addEventListener('applink-sid', handleApplinkSid);

    // Also check if sid was injected before this component mounted
    const pendingSid = (window as any).__pendingSid;
    if (pendingSid) {
      loadScenarioFromSupabase(pendingSid)
        .then(setContentScenario)
        .catch((err) => console.error('[AppLink] Failed to load pending scenario:', err));
    }

    return () => window.removeEventListener('applink-sid', handleApplinkSid);
  }, []);

  useEffect(() => {
    // Check if this is a payment success redirect
    const path = window.location.pathname;
    const search = window.location.search;
    if (path === '/payment-success' && search.includes('session_id')) {
      setShowPaymentSuccess(true);
    }

    // Check for content mode scenario
    const urlParams = new URLSearchParams(window.location.search);
    const scenarioName = urlParams.get('scenario');
    const scenarioId = urlParams.get('sid');
    if (scenarioId) {
      // Load from Supabase by UUID
      loadScenarioFromSupabase(scenarioId)
        .then((scenario) => {
          console.log('[ContentMode] Loaded scenario from Supabase:', scenario.id);
          setContentScenario(scenario);
        })
        .catch((err) => console.error('[ContentMode] Failed to load scenario from Supabase:', err));
    } else if (scenarioName) {
      // Load from static file
      loadScenario(scenarioName)
        .then((scenario) => {
          console.log('[ContentMode] Loaded scenario:', scenario.id);
          setContentScenario(scenario);
        })
        .catch((err) => console.error('[ContentMode] Failed to load scenario:', err));
    }

    (async () => {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setIsAuthenticated(!!session);
      });

      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
      setLoading(false);

      return () => subscription.unsubscribe();
    })();
  }, []);

  function handleAnalysisComplete(analysisId: string) {
    setCurrentAnalysisId(analysisId);
    setAnalyzeSubPage('results');
  }

  function handleAuthSuccess() {
    setIsAuthenticated(true);
  }

  function handlePaymentComplete(analysisId?: string) {
    // Clear the URL params
    window.history.replaceState({}, '', '/');
    setShowPaymentSuccess(false);

    // If guest created an account, exit guest mode
    if (guestMode) {
      setGuestMode(false);
      localStorage.setItem('has_visited', 'true');
    }

    // If we have an analysis ID, show the results
    if (analysisId) {
      setCurrentAnalysisId(analysisId);
      setAnalyzeSubPage('results');
      setActiveTab('analyze');
    } else {
      // Default to connections for returning authenticated users
      setActiveTab('connections');
    }
  }

  // Show payment success page if redirected from Stripe
  // Share landing page — public, no auth needed
  // Handles both /share/{id} (direct) and /?share={id} (redirect from Edge Function)
  const sharePath = window.location.pathname.match(/^\/share\/([a-f0-9-]+)$/i);
  const shareParam = new URLSearchParams(window.location.search).get('share');
  const shareId = sharePath?.[1] || shareParam;
  if (shareId) {
    return <ShareLandingPage shareId={shareId} />;
  }

  if (showPaymentSuccess) {
    return <PaymentSuccessPage onComplete={handlePaymentComplete} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-lg" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
          Loading...
        </div>
      </div>
    );
  }

  // Content mode: skip auth entirely
  // Guest mode: first-time users skip auth and go straight to upload
  const hasSidParam = new URLSearchParams(window.location.search).has('sid');
  if (!contentScenario && !hasSidParam && !isAuthenticated && !guestMode) {
    // First visit ever? Skip auth, go to upload
    if (!localStorage.getItem('has_visited')) {
      setGuestMode(true);
    } else {
      return <AuthPage onAuthSuccess={handleAuthSuccess} />;
    }
  }

  // Authenticated (or content mode or guest mode): show tab-based layout
  function renderTabContent() {
    switch (activeTab) {
      case 'analyze':
        return analyzeSubPage === 'results'
          ? <ResultsPage analysisId={currentAnalysisId} isGuest={guestMode} />
          : <UploadPage onAnalyze={handleAnalysisComplete} contentScenario={contentScenario} isGuest={guestMode} />;
      case 'connections':
        return connectionsSubPage === 'profile'
          ? <PersonProfile personId={selectedPersonId} onBack={() => setConnectionsSubPage('list')} onAnalyzeNew={() => setActiveTab('analyze')} />
          : <ConnectionsPage onAnalyzeNew={() => setActiveTab('analyze')} onSelectPerson={(id) => { setSelectedPersonId(id); setConnectionsSubPage('profile'); }} />;
      case 'soul':
        return <SoulPage />;
    }
  }

  function handleTabChange(tab: TabId) {
    if (tab === 'connections') setConnectionsSubPage('list');
    setActiveTab(tab);
  }

  return (
    <div className="min-h-screen bg-black overflow-x-hidden">
      <div className={guestMode ? '' : 'pb-[72px]'}>
        {renderTabContent()}
      </div>
      {!guestMode && <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />}
    </div>
  );
}

export default App;
