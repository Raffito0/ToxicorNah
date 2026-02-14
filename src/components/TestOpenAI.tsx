import { useState } from 'react';
import { analyzeChatScreenshots } from '../services/openaiService';

export default function TestOpenAI() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setResult(null);
      setError(null);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      console.log('Starting OpenAI analysis...');
      const analysisResult = await analyzeChatScreenshots([selectedFile]);
      console.log('OpenAI analysis complete:', analysisResult);
      setResult(analysisResult);
    } catch (err) {
      console.error('OpenAI analysis error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <h1 className="text-4xl font-bold text-white mb-2">
            OpenAI Vision API Test
          </h1>
          <p className="text-white/70 mb-8">
            Test GPT-4o Vision analysis directly (no database)
          </p>

          <div className="space-y-6">
            {/* File Upload */}
            <div>
              <label className="block text-white mb-2 font-medium">
                Upload Chat Screenshot
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full text-white bg-white/10 border border-white/30 rounded-lg p-3 cursor-pointer hover:bg-white/20 transition"
              />
              {selectedFile && (
                <p className="text-green-400 mt-2 text-sm">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>

            {/* Analyze Button */}
            <button
              onClick={handleAnalyze}
              disabled={!selectedFile || loading}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-xl font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:from-purple-700 hover:to-pink-700 transition"
            >
              {loading ? 'Analyzing with GPT-4o Vision...' : 'Analyze Chat'}
            </button>

            {/* Error Display */}
            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-4">
                <p className="text-red-200 font-medium">Error:</p>
                <p className="text-red-100 text-sm mt-1">{error}</p>
              </div>
            )}

            {/* Results Display */}
            {result && (
              <div className="bg-white/5 border border-white/20 rounded-lg p-6 space-y-4">
                <h2 className="text-2xl font-bold text-white mb-4">
                  Analysis Results
                </h2>

                {/* Scores */}
                <div className="bg-white/10 rounded-lg p-4">
                  <h3 className="text-xl font-semibold text-white mb-3">
                    Toxicity Scores
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-white/60 text-sm">Overall</p>
                      <p className="text-white text-2xl font-bold">
                        {result.scores.overall}/100
                      </p>
                    </div>
                    <div>
                      <p className="text-white/60 text-sm">Warmth</p>
                      <p className="text-white text-xl">
                        {result.scores.warmth}/100
                      </p>
                    </div>
                    <div>
                      <p className="text-white/60 text-sm">Communication</p>
                      <p className="text-white text-xl">
                        {result.scores.communication}/100
                      </p>
                    </div>
                    <div>
                      <p className="text-white/60 text-sm">Drama</p>
                      <p className="text-white text-xl">
                        {result.scores.drama}/100
                      </p>
                    </div>
                    <div>
                      <p className="text-white/60 text-sm">Distance</p>
                      <p className="text-white text-xl">
                        {result.scores.distance}/100
                      </p>
                    </div>
                    <div>
                      <p className="text-white/60 text-sm">Passion</p>
                      <p className="text-white text-xl">
                        {result.scores.passion}/100
                      </p>
                    </div>
                  </div>
                </div>

                {/* Profile */}
                <div className="bg-white/10 rounded-lg p-4">
                  <h3 className="text-xl font-semibold text-white mb-2">
                    Profile: {result.profile.type}
                  </h3>
                  <p className="text-purple-300 font-medium mb-2">
                    {result.profile.subtitle}
                  </p>
                  <p className="text-white/80">{result.profile.description}</p>
                </div>

                {/* Archetypes */}
                <div className="bg-white/10 rounded-lg p-4">
                  <h3 className="text-xl font-semibold text-white mb-2">
                    Emotional Archetypes
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {result.emotionalArchetypes.map((archetype: string, i: number) => (
                      <span
                        key={i}
                        className="bg-purple-500/30 text-purple-200 px-3 py-1 rounded-full text-sm"
                      >
                        {archetype}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Message Insights */}
                <div className="bg-white/10 rounded-lg p-4">
                  <h3 className="text-xl font-semibold text-white mb-3">
                    Message Insights ({result.messageInsights.length})
                  </h3>
                  <div className="space-y-3">
                    {result.messageInsights.map((insight: any, i: number) => (
                      <div key={i} className="bg-white/5 rounded-lg p-3 border border-white/10">
                        <p className="text-white font-medium mb-1">
                          "{insight.message}"
                        </p>
                        <p className="text-purple-300 text-sm mb-1">
                          {insight.title}
                        </p>
                        <p className="text-white/70 text-sm">
                          {insight.description}
                        </p>
                        <p className="text-green-300 text-sm mt-2">
                          💡 {insight.solution}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Relationship Archetypes */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-white/10 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {result.personArchetype.name}
                    </h3>
                    <p className="text-purple-300 text-sm mb-2">
                      {result.personArchetype.title}
                    </p>
                    <p className="text-white/80 text-sm mb-3">
                      {result.personArchetype.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.personArchetype.traits.map((trait: string, i: number) => (
                        <span
                          key={i}
                          className="bg-red-500/30 text-red-200 px-2 py-1 rounded text-xs"
                        >
                          {trait}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white/10 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {result.userArchetype.name}
                    </h3>
                    <p className="text-green-300 text-sm mb-2">
                      {result.userArchetype.title}
                    </p>
                    <p className="text-white/80 text-sm mb-3">
                      {result.userArchetype.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.userArchetype.traits.map((trait: string, i: number) => (
                        <span
                          key={i}
                          className="bg-green-500/30 text-green-200 px-2 py-1 rounded text-xs"
                        >
                          {trait}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Raw JSON */}
                <details className="bg-white/5 rounded-lg p-4">
                  <summary className="text-white font-medium cursor-pointer">
                    View Raw JSON
                  </summary>
                  <pre className="mt-3 text-xs text-white/80 overflow-auto max-h-96">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-6 bg-blue-500/20 border border-blue-500/50 rounded-lg p-4">
          <p className="text-blue-200 text-sm">
            <strong>💡 Info:</strong> Questa pagina testa direttamente l'API OpenAI GPT-4o Vision.
            Non usa il database o Supabase - è un test puro dell'AI.
            Carica uno screenshot di chat (WhatsApp, iMessage, etc.) e analizza!
          </p>
        </div>
      </div>
    </div>
  );
}
