
import React, { useState } from 'react';
import { StoryEditor } from './components/StoryEditor';
import { VisualGenerator } from './components/VisualGenerator';
import { PreviewPlayer } from './components/PreviewPlayer';
import { Scene, AspectRatio, AppStep, StoryState, Language, StoryMetadata, SubtitleStyle, SubtitleAnimation } from './types';
import { translations } from './utils/translations';
import { promptVeoKeySelection } from './services/geminiService';

function App() {
  const [step, setStep] = useState<AppStep>(AppStep.Drafting);
  const [language, setLanguage] = useState<Language>('es');
  const [autoRenderTrigger, setAutoRenderTrigger] = useState(false); 
  const [enableAutoAdvance, setEnableAutoAdvance] = useState(true); 
  const [enableAutoDownload, setEnableAutoDownload] = useState(true); 
  
  // Lifted State for Global Configuration (Visuals + Audio)
  const [selectedVoice, setSelectedVoice] = useState('Fenrir');
  const [subStyle, setSubStyle] = useState<SubtitleStyle>({
    visible: true,
    fontFamily: "'Roboto', sans-serif", 
    fontSize: 1.0,
    textColor: '#FFFFFF',
    activeTextColor: '#FBBF24', 
    outlineColor: '#000000',
    strokeWidth: 4,
    backgroundColor: '#000000',
    backgroundOpacity: 0.0,
    verticalPosition: 85, // Default to bottom
    showFutureText: true,
    animation: SubtitleAnimation.Pop
  });

  // Audio State
  const [bgMusicFile, setBgMusicFile] = useState<File | null>(null);
  const [bgMusicVolume, setBgMusicVolume] = useState(0.1);
  const [narrationVolume, setNarrationVolume] = useState(1.0);

  const [state, setState] = useState<StoryState>({
    title: 'New Project',
    rawStory: '',
    scenes: [],
    totalDuration: 0,
    targetDuration: 90,
    aspectRatio: AspectRatio.Portrait
  });
  
  const t = translations[language];

  const handleScenesGenerated = (
      scenes: Scene[], 
      rawStory: string, 
      duration: number, 
      ratio: AspectRatio, 
      watermarkUrl?: string, 
      outroUrl?: string,
      visualStyle?: string,
      metadata?: StoryMetadata,
      outroType?: 'image' | 'video'
    ) => {
    setState(prev => ({
      ...prev,
      rawStory,
      scenes,
      targetDuration: duration,
      aspectRatio: ratio,
      watermarkUrl: watermarkUrl,
      outroUrl: outroUrl,
      outroType: outroType || 'image',
      visualStyle: visualStyle,
      metadata: metadata 
    }));
    setStep(AppStep.Visuals);
  };

  const handleUpdateScene = (id: string, updates: Partial<Scene>) => {
    setState(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => s.id === id ? { ...s, ...updates } : s)
    }));
  };

  const handleDeleteScene = (id: string) => {
    setState(prev => ({
      ...prev,
      scenes: prev.scenes.filter(s => s.id !== id)
    }));
  };
  
  const handleVisualsComplete = (autoRender: boolean = false) => {
      setAutoRenderTrigger(autoRender);
      setStep(AppStep.Preview);
  };

  return (
    <div className="min-h-screen text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="fixed w-full top-0 z-50 transition-all duration-300 border-b border-white/5 bg-[#020617]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 group cursor-default">
             <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-tr from-violet-600 to-indigo-500 rounded-lg blur opacity-60 group-hover:opacity-100 transition duration-500"></div>
                <div className="relative bg-gradient-to-tr from-violet-600 to-indigo-600 w-9 h-9 rounded-lg flex items-center justify-center shadow-lg border border-white/10">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                  </svg>
                </div>
             </div>
             <h1 className="text-xl font-bold tracking-tight text-white hidden md:block font-['Montserrat']">
               StoryWeaver <span className="text-indigo-400">AI</span>
             </h1>
          </div>
          
          <div className="flex items-center gap-3 md:gap-6">
             {/* API Key Button */}
             <button 
               onClick={() => promptVeoKeySelection()}
               className="flex items-center space-x-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-full transition-all border border-amber-500/20"
               title="Update API Key"
             >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <span className="hidden sm:inline">{t.header.apiKey}</span>
             </button>

             {/* Language Selector */}
             <div className="relative group">
                <button className="flex items-center space-x-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors px-2 py-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="hidden sm:inline">{language === 'es' ? 'Español' : 'English'}</span>
                  <span className="sm:hidden">{language.toUpperCase()}</span>
                </button>
                <div className="absolute right-0 mt-2 w-32 bg-[#0f172a] rounded-xl shadow-2xl border border-white/10 overflow-hidden hidden group-hover:block z-50">
                    <button onClick={() => setLanguage('es')} className="block w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors">Español</button>
                    <button onClick={() => setLanguage('en')} className="block w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors">English</button>
                </div>
             </div>

             {/* Navigation Pills */}
             <nav className="flex bg-white/5 p-1 rounded-full border border-white/5 backdrop-blur-md">
               {[
                 { id: AppStep.Drafting, label: t.header.stepDrafting },
                 { id: AppStep.Visuals, label: t.header.stepVisuals, disabled: state.scenes.length === 0 },
                 { id: AppStep.Preview, label: t.header.stepPreview, disabled: !state.scenes.some(sc => sc.mediaUrl) }
               ].map((item) => (
                 <button
                    key={item.id}
                    onClick={() => !item.disabled && setStep(item.id)}
                    disabled={item.disabled}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${
                      step === item.id 
                        ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/25' 
                        : item.disabled 
                          ? 'text-slate-600 cursor-not-allowed' 
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                 >
                   {item.label}
                 </button>
               ))}
             </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-28 relative z-0">
        
        {/* Ambient background glow */}
        <div className="fixed top-20 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-600/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

        {step === AppStep.Drafting && (
          <StoryEditor 
            language={language}
            onScenesGenerated={handleScenesGenerated}
            enableAutoAdvance={enableAutoAdvance}
            onToggleAutoAdvance={setEnableAutoAdvance}
            enableAutoDownload={enableAutoDownload}
            onToggleAutoDownload={setEnableAutoDownload}
          />
        )}

        {step === AppStep.Visuals && (
          <VisualGenerator 
            scenes={state.scenes} 
            aspectRatio={state.aspectRatio} 
            language={language}
            onUpdateScene={handleUpdateScene}
            onDeleteScene={handleDeleteScene}
            onComplete={handleVisualsComplete} 
            visualStyle={state.visualStyle} 
            metadata={state.metadata} 
            autoAdvanceEnabled={enableAutoAdvance} 
            autoDownloadEnabled={enableAutoDownload}
            // Pass global audio/sub state
            selectedVoice={selectedVoice}
            onVoiceChange={setSelectedVoice}
            subStyle={subStyle}
            onSubStyleChange={setSubStyle}
            // Audio Props
            bgMusicFile={bgMusicFile}
            onMusicChange={setBgMusicFile}
            bgMusicVolume={bgMusicVolume}
            onMusicVolChange={setBgMusicVolume}
            narrationVolume={narrationVolume}
            onNarrationVolChange={setNarrationVolume}
          />
        )}

        {step === AppStep.Preview && (
          <PreviewPlayer 
            scenes={state.scenes} 
            aspectRatio={state.aspectRatio}
            language={language}
            onBack={() => setStep(AppStep.Visuals)}
            autoRenderOnMount={autoRenderTrigger}
            initialWatermark={state.watermarkUrl}
            initialOutro={state.outroUrl}
            initialOutroType={state.outroType}
            projectTitle={state.rawStory}
            suggestedVoice={state.metadata?.recommendedVoice}
            // Pass the pre-configured state
            initialSelectedVoice={selectedVoice}
            initialSubStyle={subStyle}
            // Audio State
            initialBgMusicFile={bgMusicFile}
            initialBgMusicVolume={bgMusicVolume}
            initialNarrationVolume={narrationVolume}
          />
        )}
      </main>
      
      <footer className="border-t border-white/5 py-8 text-center">
         <p className="text-slate-500 text-sm font-medium">{t.footer}</p>
      </footer>
    </div>
  );
}

export default App;