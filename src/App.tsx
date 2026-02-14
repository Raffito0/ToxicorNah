import { useState, useEffect } from 'react';
import { AuthPage } from './components/AuthPage';
import { UploadPage } from './components/UploadPage';
import { ResultsPage } from './components/ResultsPage';
import { ConnectionsPage } from './components/ConnectionsPage';
import { PersonProfile } from './components/PersonProfile';
import { SoulPage } from './components/SoulPage';
import { PaymentSuccessPage } from './components/PaymentSuccessPage';
import { BottomNav, TabId } from './components/BottomNav';
import { supabase } from './lib/supabase';
import { loadScenario, loadScenarioFromSupabase } from './services/contentModeService';
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

    // If we have an analysis ID, show the results
    if (analysisId) {
      setCurrentAnalysisId(analysisId);
      setAnalyzeSubPage('results');
      setActiveTab('analyze');
    }
  }

  // Show payment success page if redirected from Stripe
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
  if (!contentScenario && !isAuthenticated) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />;
  }

  // Authenticated (or content mode): show tab-based layout
  function renderTabContent() {
    switch (activeTab) {
      case 'analyze':
        return analyzeSubPage === 'results'
          ? <ResultsPage analysisId={currentAnalysisId} />
          : <UploadPage onAnalyze={handleAnalysisComplete} contentScenario={contentScenario} />;
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
      <div className="pb-[72px]">
        {renderTabContent()}
      </div>
      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
}

export default App;
