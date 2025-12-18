import React, { useState } from 'react';
import { AspectRatio, Language, Scene, StoryMetadata } from '../types';
import { analyzeAndBreakdownStory, generateStoryFromTopic, VISUAL_STYLES } from '../services/geminiService';
import { LiveAssistant } from './LiveAssistant';
import { translations } from '../utils/translations';

interface StoryEditorProps {
  language: Language;
  onScenesGenerated: (
      scenes: Scene[], 
      rawStory: string, 
      duration: number, 
      ratio: AspectRatio, 
      watermark?: string, 
      outro?: string,
      visualStyle?: string,
      metadata?: StoryMetadata,
      outroType?: 'image' | 'video'
    ) => void;
  enableAutoAdvance: boolean;
  onToggleAutoAdvance: (enabled: boolean) => void;
  enableAutoDownload: boolean;
  onToggleAutoDownload: (enabled: boolean) => void;
}

export const StoryEditor: React.FC<StoryEditorProps> = ({ 
    language, 
    onScenesGenerated, 
    enableAutoAdvance,
    onToggleAutoAdvance,
    enableAutoDownload, 
    onToggleAutoDownload 
}) => {
  const [story, setStory] = useState('');
  const [duration, setDuration] = useState(90);
  const [ratio, setRatio] = useState<AspectRatio>(AspectRatio.Portrait);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMagicProcessing, setIsMagicProcessing] = useState(false);
  
  const [selectedStyle, setSelectedStyle] = useState<string>('');

  const [includeHook, setIncludeHook] = useState(false);
  const [hookText, setHookText] = useState('');
  const [includeCTA, setIncludeCTA] = useState(false);
  const [ctaText, setCtaText] = useState('');

  const [watermarkUrl, setWatermarkUrl] = useState<string | undefined>(undefined);
  const [outroUrl, setOutroUrl] = useState<string | undefined>(undefined);
  const [outroType, setOutroType] = useState<'image' | 'video'>('image');

  const t = translations[language].editor;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (url: string) => void) => {
    const file = e.target.files?.[0];
    if (file) setter(URL.createObjectURL(file));
  };

  const handleMagicGenerate = async () => {
    if (!story.trim()) return;
    setIsMagicProcessing(true);
    try {
      const finalHook = includeHook && hookText.trim() ? hookText : undefined;
      const finalCta = includeCTA && ctaText.trim() ? ctaText : undefined;
      
      const fullScript = await generateStoryFromTopic(story, duration, language, finalCta, finalHook);
      setStory(fullScript);
    } catch (e) {
      console.error(e);
      alert("Failed to auto-write story.");
    } finally {
      setIsMagicProcessing(false);
    }
  };

  const handleGenerate = async () => {
    if (!story.trim()) return;
    setIsProcessing(true);
    try {
      let finalScript = story.trim();

      const { scenes, metadata } = await analyzeAndBreakdownStory(finalScript, duration, language);
      
      if (includeCTA && scenes.length > 0) {
          scenes[scenes.length - 1].isCta = true;
      }

      onScenesGenerated(
          scenes, 
          finalScript, 
          duration, 
          ratio, 
          watermarkUrl, 
          outroUrl, 
          selectedStyle, 
          metadata,
          outroType
      );

    } catch (e) {
      console.error(e);
      alert("Failed to analyze story. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-2 mb-8">
        <h2 className="text-3xl font-extrabold text-white tracking-tight font-['Montserrat'] bg-clip-text text-transparent bg-gradient-to-r from-violet-200 to-indigo-200 inline-block">{t.title}</h2>
        <p className="text-slate-400 max-w-lg mx-auto leading-relaxed">{t.desc}</p>
      </div>

      <LiveAssistant language={language} />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center">
             <label className="block text-sm font-semibold text-slate-300">{t.duration || "Duración"}</label>
             <span className="text-xs font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">{formatTime(duration)}</span>
          </div>
          <div className="flex items-center space-x-3">
             <input type="range" min="10" max="1200" step="10" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="flex-1 accent-indigo-500" />
             <div className="flex items-center space-x-1 border-l border-white/10 pl-3">
               <input type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 10)} className="w-16 bg-slate-800 border border-white/10 rounded px-1 text-center text-white text-sm" />
               <span className="text-slate-500 text-xs font-mono">s</span>
             </div>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <label className="block text-sm font-semibold text-slate-300">{t.ratioLabel || "Formato"}</label>
          <div className="flex p-1 bg-slate-900/50 rounded-lg border border-white/5">
            {[AspectRatio.Landscape, AspectRatio.Portrait, AspectRatio.Square].map((r) => (
              <button key={r} onClick={() => setRatio(r)} className={`flex-1 py-2 rounded-md text-xs font-semibold ${ratio === r ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>{r}</button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="glass-panel rounded-xl p-4 flex flex-col sm:flex-row gap-4 justify-between items-center border-l-4 border-l-indigo-500">
          <div className="flex items-center space-x-3">
              <input type="checkbox" id="autoAdvance" checked={enableAutoAdvance} onChange={(e) => onToggleAutoAdvance(e.target.checked)} className="w-5 h-5 accent-indigo-600" />
              <label htmlFor="autoAdvance" className="text-sm font-medium text-white cursor-pointer select-none">{t.autoAdvance}</label>
          </div>
          <div className="flex items-center space-x-3">
              <input type="checkbox" id="autoDownload" checked={enableAutoDownload} onChange={(e) => onToggleAutoDownload(e.target.checked)} className="w-5 h-5 accent-emerald-500" />
              <label htmlFor="autoDownload" className="text-sm font-medium text-white cursor-pointer select-none">{t.autoDownload}</label>
          </div>
      </div>
      
      <div className="glass-panel rounded-2xl p-5 space-y-3">
          <label className="block text-sm font-semibold text-slate-300">{t.styleLabel || "Estilo Visual"}</label>
          <select value={selectedStyle} onChange={(e) => setSelectedStyle(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none">
              <option value="">{t.stylePlaceholder || "Selecciona un estilo..."}</option>
              {VISUAL_STYLES.map((group, idx) => (
                  <optgroup key={idx} label={group.category}>
                      {group.options.map(style => <option key={style.id} value={style.prompt}>{style.label}</option>)}
                  </optgroup>
              ))}
          </select>
      </div>

      <div className="glass-panel rounded-2xl p-6 space-y-6">
         <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-white/5 pb-2">Estructura & Marca</h3>
         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <div className="space-y-6">
                <div className="space-y-3">
                    <div className="flex items-center space-x-3" onClick={() => setIncludeHook(!includeHook)}>
                        <div className={`w-10 h-5 flex items-center bg-slate-700 rounded-full p-1 transition-colors ${includeHook ? 'bg-indigo-600' : ''}`}><div className={`bg-white w-3 h-3 rounded-full transform transition-transform ${includeHook ? 'translate-x-5' : ''}`}></div></div>
                        <label className="text-sm font-medium text-slate-200 cursor-pointer">{t.hookLabel}</label>
                    </div>
                    {includeHook && <input type="text" value={hookText} onChange={(e) => setHookText(e.target.value)} placeholder={t.hookPlaceholder} className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-sm text-white" />}
                </div>
                <div className="space-y-3">
                    <div className="flex items-center space-x-3" onClick={() => setIncludeCTA(!includeCTA)}>
                        <div className={`w-10 h-5 flex items-center bg-slate-700 rounded-full p-1 transition-colors ${includeCTA ? 'bg-indigo-600' : ''}`}><div className={`bg-white w-3 h-3 rounded-full transform transition-transform ${includeCTA ? 'translate-x-5' : ''}`}></div></div>
                        <label className="text-sm font-medium text-slate-200 cursor-pointer">{t.ctaLabel}</label>
                    </div>
                    {includeCTA && <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder={t.ctaPlaceholder} className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-sm text-white" />}
                </div>
             </div>
             <div className="space-y-4 md:border-l border-white/5 md:pl-8">
                   <label className="text-xs font-semibold text-slate-400 block mb-2">{t.brandingTitle || "Marca"}</label>
                   <div className="bg-slate-900/40 rounded-lg border border-white/5 p-3 flex items-center justify-between">
                        <span className="text-xs text-slate-300 truncate">{watermarkUrl ? "Logo Cargado" : t.uploadLogo}</span>
                        <label className="cursor-pointer bg-slate-700 px-3 py-1.5 rounded text-[10px] font-bold uppercase">{t.upload}<input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, setWatermarkUrl)} /></label>
                   </div>
             </div>
         </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-end">
            <label className="block text-sm font-semibold text-slate-300 pl-1">{t.scriptLabel}</label>
            <button onClick={handleMagicGenerate} disabled={isMagicProcessing || !story.trim()} className="bg-indigo-600 px-4 py-1.5 rounded-lg text-xs font-bold shadow-lg hover:bg-indigo-500 disabled:opacity-50">{isMagicProcessing ? t.magicProcessing : t.btnMagic}</button>
        </div>
        <textarea value={story} onChange={(e) => setStory(e.target.value)} placeholder={t.placeholder} className="w-full h-48 bg-[#020617] border border-white/10 rounded-xl p-5 text-slate-100 focus:outline-none resize-none leading-relaxed" />
      </div>

      <div className="pt-4 pb-20">
        <button onClick={handleGenerate} disabled={isProcessing || !story.trim()} className={`w-full py-4 rounded-xl font-bold text-lg tracking-wide transition-all shadow-xl ${isProcessing || !story.trim() ? 'bg-slate-800 text-slate-500' : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-indigo-500/25'}`}>
          {isProcessing ? t.btnProcessing : t.btnGenerate}
        </button>
      </div>
    </div>
  );
};