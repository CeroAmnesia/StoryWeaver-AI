
import React, { useState, useEffect } from 'react';
import { AspectRatio, Language, Scene, StoryMetadata } from '../types';
import { analyzeAndBreakdownStory, generateStoryFromTopic, VISUAL_STYLES, getTrendingSuggestions, subscribeToQueueStatus } from '../services/geminiService';
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
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [trendingIdeas, setTrendingIdeas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Establecer el estilo Ultra Realistic (cine-1) como predeterminado
  const [selectedStyle, setSelectedStyle] = useState<string>(VISUAL_STYLES[0].options[0].prompt);

  const [includeHook, setIncludeHook] = useState(true);
  const [hookText, setHookText] = useState('');
  const [includeCTA, setIncludeCTA] = useState(true);
  const [ctaText, setCtaText] = useState('');

  const [watermarkUrl, setWatermarkUrl] = useState<string | undefined>(undefined);
  const [queueStatus, setQueueStatus] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToQueueStatus(setQueueStatus);
  }, []);

  const t = translations[language].editor;

  const handleFetchTrends = async () => {
      setIsSuggesting(true);
      try {
          const ideas = await getTrendingSuggestions(language);
          setTrendingIdeas(ideas);
      } catch (e) {
          console.error("Trends Error:", e);
      } finally {
          setIsSuggesting(false);
      }
  };

  const handleMagicGenerate = async (topic?: string) => {
    const targetTopic = topic || story;
    if (!targetTopic.trim()) return;
    setIsMagicProcessing(true);
    setError(null);
    try {
      const finalHook = includeHook && hookText.trim() ? hookText : undefined;
      const finalCta = includeCTA && ctaText.trim() ? ctaText : undefined;
      const fullScript = await generateStoryFromTopic(targetTopic, duration, language, finalCta, finalHook);
      setStory(fullScript);
    } catch (e: any) {
      console.error("Magic Script Error:", e);
      setError(e.message || "Error al generar el guion.");
    } finally {
      setIsMagicProcessing(false);
    }
  };

  const handleGenerate = async () => {
    if (!story.trim()) return;
    setIsProcessing(true);
    setError(null);
    try {
      // Mensaje de estado inicial
      setError("Analizando narrativa y preparando escenas...");
      const { scenes, metadata } = await analyzeAndBreakdownStory(story.trim(), duration, language);
      setError(null);
      onScenesGenerated(scenes, story.trim(), duration, ratio, watermarkUrl, undefined, selectedStyle, metadata);
    } catch (e: any) {
      console.error("Breakdown Error:", e);
      setError(e.message || "Error al procesar la historia.");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-in pb-20">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-black text-white tracking-tight font-['Montserrat'] bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 to-violet-300 inline-block uppercase italic">StoryWeaver Studio</h2>
        <p className="text-slate-400 max-w-lg mx-auto text-sm">{t.desc}</p>
      </div>

      <LiveAssistant language={language} />

      <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
              <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">Ideas en Tendencia</h3>
              <button onClick={handleFetchTrends} disabled={isSuggesting} className="text-[10px] text-slate-500 hover:text-white flex items-center gap-2 transition-all">
                  {isSuggesting ? 'Analizando Redes...' : 'Sugerir Temas Viral ✨'}
              </button>
          </div>
          <div className="flex flex-wrap gap-3">
              {trendingIdeas.map((idea, i) => (
                  <button key={i} onClick={() => { setStory(idea); handleMagicGenerate(idea); }} className="bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10 px-4 py-2 rounded-xl text-xs text-slate-300 transition-all">
                      {idea}
                  </button>
              ))}
          </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel rounded-3xl p-6 space-y-4 border border-white/5 shadow-2xl">
           <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.duration}</label>
           <div className="flex items-center space-x-4">
              <input type="range" min="15" max="1200" step="15" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="flex-1 accent-indigo-500" />
              <span className="text-sm font-mono text-white font-bold">{formatDuration(duration)}</span>
           </div>
        </div>

        <div className="glass-panel rounded-3xl p-6 space-y-4 border border-white/5 shadow-2xl">
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.ratio}</label>
          <div className="flex bg-black/40 p-1 rounded-2xl border border-white/5">
            {[AspectRatio.Landscape, AspectRatio.Portrait].map((r) => (
              <button key={r} onClick={() => setRatio(r)} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${ratio === r ? 'bg-white text-black shadow-lg' : 'text-slate-500 hover:text-white'}`}>{r === AspectRatio.Portrait ? 'Vertical' : 'Horizontal'}</button>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-3xl p-6 space-y-4 border border-white/5 shadow-2xl">
           <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Estilo Visual</label>
           <select value={selectedStyle} onChange={(e) => setSelectedStyle(e.target.value)} className="w-full bg-transparent border-none text-xs text-white outline-none font-bold">
              {VISUAL_STYLES.map(g => (
                  <optgroup key={g.category} label={g.category}>
                      {g.options.map(o => <option key={o.id} value={o.prompt} className="bg-slate-900">{o.label}</option>)}
                  </optgroup>
              ))}
           </select>
        </div>
      </div>

      <div className="glass-panel rounded-[2.5rem] p-8 space-y-8 border border-white/5">
         <div className="flex justify-between items-center border-b border-white/5 pb-4">
             <h3 className="text-[12px] font-black text-white uppercase tracking-widest">Estructura de la Narrativa</h3>
              <div className="flex gap-3">
                  {story.trim() && (
                    <button 
                      onClick={() => {
                        const blob = new Blob([story], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `guion-${Date.now()}.txt`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="bg-white/5 border border-white/10 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all text-slate-300 flex items-center gap-2"
                      title="Descargar Guion"
                    >
                      <span>Descargar TXT</span>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </button>
                  )}
                  <button onClick={() => handleMagicGenerate()} disabled={isMagicProcessing || !story.trim()} className="bg-indigo-600 px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 transition-all disabled:opacity-50">
                      {isMagicProcessing ? 'Escribiendo...' : 'Auto-Completar Guion ✨'}
                  </button>
              </div>
          </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <input type="checkbox" checked={includeHook} onChange={e => setIncludeHook(e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hook (Atracción Inicial)</label>
                    </div>
                    {includeHook && <input type="text" value={hookText} onChange={e => setHookText(e.target.value)} placeholder="Ej: No vas a creer lo que descubrí..." className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-indigo-500 transition-all" />}
                </div>
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <input type="checkbox" checked={includeCTA} onChange={e => setIncludeCTA(e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CTA (Llamada a la Acción)</label>
                    </div>
                    {includeCTA && <input type="text" value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="Ej: ¡Sígueme para más historias!" className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-indigo-500 transition-all" />}
                </div>
            </div>
            <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Guion del Video</label>
                <textarea value={story} onChange={(e) => setStory(e.target.value)} placeholder="Escribe el tema o pega tu guion aquí..." className="w-full h-40 bg-slate-950/50 border border-white/5 rounded-2xl p-6 text-sm text-slate-300 resize-none outline-none focus:border-indigo-500 transition-all leading-relaxed shadow-inner" />
            </div>
         </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-center">
          <div className="flex-1 flex flex-col gap-2">
              <label className="flex items-center space-x-3 cursor-pointer group">
                  <input type="checkbox" checked={enableAutoAdvance} onChange={e => onToggleAutoAdvance(e.target.checked)} className="w-5 h-5 accent-indigo-500" />
                  <span className="text-xs font-bold text-slate-400 group-hover:text-white transition-colors">Avanzar Automático</span>
              </label>
              {(error || queueStatus) && (
                <div className="text-[10px] font-bold text-amber-400 animate-pulse uppercase tracking-wider">
                  ⚠️ {queueStatus || error}
                </div>
              )}
          </div>
          <button onClick={handleGenerate} disabled={isProcessing || !story.trim()} className="w-full md:w-auto px-16 py-5 bg-white text-black rounded-2xl font-black text-sm uppercase tracking-[0.3em] hover:bg-indigo-50 hover:scale-105 active:scale-95 transition-all shadow-3xl shadow-indigo-500/10 disabled:opacity-50">
              {isProcessing ? 'Procesando...' : 'Generar Visuales'}
          </button>
      </div>
    </div>
  );
};
