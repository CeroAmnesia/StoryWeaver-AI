
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Scene, AspectRatio, MediaType, Language, VisualEffect, StoryMetadata, SubtitleStyle, SubtitleAnimation } from '../types';
import { generateImage, generateVideo, VISUAL_STYLES, VOICE_OPTIONS, generateCatchyTitle, generateThumbnail, promptVeoKeySelection, subscribeToQueueStatus, previewVoice } from '../services/geminiService';
import { translations } from '../utils/translations';

interface VisualGeneratorProps {
  scenes: Scene[];
  aspectRatio: AspectRatio;
  language: Language;
  onUpdateScene: (id: string, updates: Partial<Scene>) => void;
  onDeleteScene: (id: string) => void;
  onComplete: (autoRender?: boolean) => void;
  onCancel?: () => void; 
  visualStyle?: string; 
  metadata?: StoryMetadata; 
  autoAdvanceEnabled: boolean;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  subStyle: SubtitleStyle;
  onSubStyleChange: (style: SubtitleStyle) => void;
  thumbnailUrl?: string;
  onUpdateThumbnail: (url: string) => void;
  rawStory: string;
  bgMusicFile: File | null;
  onMusicChange: (file: File | null) => void;
  bgMusicVolume: number;
  onMusicVolChange: (vol: number) => void;
}

const FONTS = [
  { name: "'Archivo Black', sans-serif", label: "Archivo Black" },
  { name: "'Montserrat', sans-serif", label: "Montserrat" },
  { name: "'Inter', sans-serif", label: "Inter" },
  { name: "'Cinzel', serif", label: "Cinzel (Epic)" },
  { name: "'Poppins', sans-serif", label: "Poppins" },
];

export const VisualGenerator: React.FC<VisualGeneratorProps> = ({ 
    scenes, aspectRatio, language, onUpdateScene, onDeleteScene, onComplete, onCancel, visualStyle, metadata, autoAdvanceEnabled,
    thumbnailUrl, onUpdateThumbnail, rawStory, selectedVoice, onVoiceChange, subStyle, onSubStyleChange,
    bgMusicFile, onMusicChange, bgMusicVolume, onMusicVolChange
}) => {
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'scenes' | 'subtitles'>('scenes');
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const isAutoGeneratingRef = useRef(false);

  useEffect(() => {
    return subscribeToQueueStatus(setQueueStatus);
  }, []);
  
  const t = translations[language].visuals;

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  };

  const sanitizeError = useCallback((err: any) => {
    const msg = String(err).toLowerCase();
    if (msg.includes("quota") || msg.includes("429") || msg.includes("exceeded") || msg.includes("cuota") || msg.includes("limit")) {
      return "Optimizando cola de renderizado... (Espera técnica)";
    }
    if (msg.includes("overloaded") || msg.includes("503")) {
      return "Servidor saturado, reintentando...";
    }
    if (msg.includes("permission") || msg.includes("403") || msg.includes("key")) {
      return "Falta llave API o permisos (Veo/Imagen). Selecciona una llave válida.";
    }
    return "Reintentando conexión...";
  }, []);

  const handleGenerateImage = async (scene: Scene) => {
    if (scene.isGenerating) return;
    
    onUpdateScene(scene.id, { isGenerating: true, error: "Renderizando escena...", mediaType: MediaType.Image });
    try {
      const dna = metadata?.consistentStyle || "High fidelity documentary visual style";
      const result = await generateImage(scene.visualPrompt, aspectRatio, visualStyle, dna);
      
      if (scene.mediaUrl && scene.mediaUrl.startsWith('blob:')) {
        URL.revokeObjectURL(scene.mediaUrl);
      }
      
      onUpdateScene(scene.id, { mediaUrl: result.url, isGenerating: false, error: undefined });
      return true;
    } catch (e: any) {
      onUpdateScene(scene.id, { isGenerating: false, error: sanitizeError(e) });
      return false;
    }
  };

  const handleGenerateVideo = async (scene: Scene) => {
    if (scene.isGenerating) return;
    
    const hasKey = await promptVeoKeySelection();
    if (!hasKey) {
      onUpdateScene(scene.id, { error: "Selecciona una llave API para generar video." });
      return false;
    }

    onUpdateScene(scene.id, { isGenerating: true, error: "Preparando Veo...", mediaType: MediaType.Video });
    try {
      let base64Image = undefined;
      if (scene.mediaUrl && scene.mediaType === MediaType.Image && scene.mediaUrl.startsWith('data:')) {
        base64Image = scene.mediaUrl.split(',')[1];
      }

      const result = await generateVideo(scene.visualPrompt, aspectRatio, (msg) => {
        onUpdateScene(scene.id, { error: msg });
      }, base64Image);
      
      if (scene.mediaUrl && scene.mediaUrl.startsWith('blob:')) {
        URL.revokeObjectURL(scene.mediaUrl);
      }

      onUpdateScene(scene.id, { mediaUrl: result.url, mediaMimeType: result.mimeType, isGenerating: false, error: undefined });
      return true;
    } catch (e: any) {
      onUpdateScene(scene.id, { isGenerating: false, error: sanitizeError(e) });
      return false;
    }
  };

  const stopGeneration = () => {
    setIsAutoGenerating(false);
    isAutoGeneratingRef.current = false;
    scenes.forEach(s => {
      if (s.isGenerating) {
        onUpdateScene(s.id, { isGenerating: false, error: "Detenido por el usuario." });
      }
    });
  };

  const startSequentialGen = async () => {
    if (isAutoGenerating) {
        stopGeneration();
        return;
    }
    setIsAutoGenerating(true);
    isAutoGeneratingRef.current = true;

    // Generar miniatura si falta
    if (!thumbnailUrl) {
      try {
        setIsGeneratingThumbnail(true);
        const title = await generateCatchyTitle(rawStory, language);
        const res = await generateThumbnail(rawStory, visualStyle || VISUAL_STYLES[0].options[0].prompt, title, aspectRatio);
        onUpdateThumbnail(res.url);
      } catch (e) {} finally { setIsGeneratingThumbnail(false); }
    }

    // Generación secuencial: una a una para máxima estabilidad
    const missing = scenes.filter(s => !s.mediaUrl && !s.isGenerating);
    for (const scene of missing) {
      if (!isAutoGeneratingRef.current) break;
      await handleGenerateImage(scene);
    }
  };

  // Efecto para detectar finalización automática
  useEffect(() => {
    if (isAutoGenerating && scenes.every(s => s.mediaUrl || s.error)) {
      // Si todas tienen media o error, y no hay ninguna generando, terminamos el modo auto
      if (scenes.every(s => !s.isGenerating)) {
        setIsAutoGenerating(false);
        isAutoGeneratingRef.current = false;
        if (autoAdvanceEnabled && scenes.every(s => s.mediaUrl)) {
          const timer = setTimeout(() => onComplete(true), 1500);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [scenes, isAutoGenerating, autoAdvanceEnabled, onComplete]);

  // Inicio automático al montar
  useEffect(() => {
    const timer = setTimeout(() => {
      const needsGen = scenes.some(s => !s.mediaUrl && !s.isGenerating);
      if (needsGen && !isAutoGeneratingRef.current) {
        startSequentialGen();
      }
    }, 1000);
    return () => { 
      clearTimeout(timer);
      isAutoGeneratingRef.current = false; 
    };
  }, []);

  const progress = Math.round((scenes.filter(s => s.mediaUrl).length / scenes.length) * 100);

  const handlePreviewVoice = async (voiceName: string) => {
    if (previewingVoice) return;
    setPreviewingVoice(voiceName);
    try {
      const base64 = await previewVoice(voiceName, language);
      const audio = new Audio(`data:audio/wav;base64,${base64}`);
      audio.play();
    } catch (e) {
      console.error("Error previewing voice:", e);
    } finally {
      setPreviewingVoice(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto animate-fade-in pb-24 space-y-12">
      {/* Header de Control */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-slate-900/60 p-10 rounded-[3rem] border border-white/5 backdrop-blur-2xl shadow-3xl">
         <div className="space-y-4">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Director de Arte Documental</h2>
            <div className="flex items-center gap-5">
                <div className="w-64 h-2.5 bg-slate-800 rounded-full overflow-hidden border border-white/5 p-0.5">
                    <div className="h-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-emerald-500 transition-all duration-1000 shadow-[0_0_20px_rgba(16,185,129,0.4)]" style={{ width: `${progress}%` }}></div>
                </div>
                <span className="text-[11px] font-black text-emerald-400 uppercase tracking-[0.3em]">{progress}% LISTO</span>
            </div>
            {queueStatus && (
              <p className="text-[10px] font-bold text-amber-400 animate-pulse uppercase tracking-widest">
                ⚠️ {queueStatus}
              </p>
            )}
         </div>
         <div className="flex gap-4 mt-8 md:mt-0">
            {isAutoGenerating || scenes.some(s => s.isGenerating) ? (
              <button 
                onClick={stopGeneration} 
                className="px-12 py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] border border-red-500 bg-red-600 text-white hover:bg-red-500 transition-all shadow-lg shadow-red-500/40 animate-pulse"
              >
                {t.btnStop || 'Detener Motor'}
              </button>
            ) : (
              scenes.some(s => !s.mediaUrl) && (
                <button 
                  onClick={startSequentialGen} 
                  className="px-12 py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] border border-white/10 bg-slate-950 text-white hover:bg-slate-900 transition-all"
                >
                  {t.btnResume || 'Reanudar'}
                </button>
              )
            )}
            
            {onCancel && (
              <button 
                onClick={() => {
                  if (window.confirm("¿Deseas cancelar y volver al borrador?")) {
                    stopGeneration();
                    onCancel();
                  }
                }}
                className="px-8 py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] border border-white/5 bg-slate-900 text-slate-400 hover:text-white transition-all"
              >
                {t.btnCancel || 'Cancelar'}
              </button>
            )}
            
            <button 
              onClick={() => onComplete(false)} 
              className="bg-white text-black px-14 py-4 rounded-2xl font-black uppercase text-[11px] tracking-[0.3em] shadow-2xl hover:bg-indigo-50 transition-all active:scale-95 disabled:opacity-30"
              disabled={!scenes.some(s => s.mediaUrl)}
            >
              Ir a Producción
            </button>
         </div>
      </div>

      {/* Tabs de Navegación */}
      <div className="flex justify-center">
        <div className="bg-white/5 p-1 rounded-2xl border border-white/5 flex">
            <button 
                onClick={() => setActiveTab('scenes')}
                className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'scenes' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
            >
                Escenas
            </button>
            <button 
                onClick={() => setActiveTab('subtitles')}
                className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'subtitles' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
            >
                Voz & Texto
            </button>
        </div>
      </div>

      {/* Contenido de Tabs */}
      {activeTab === 'scenes' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 animate-fade-in">
          {scenes.map((scene, idx) => (
              <div key={scene.id} className={`glass-panel rounded-[3rem] p-8 border transition-all duration-500 group ${scene.isGenerating ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/5 hover:border-white/20'}`}>
                  <div className="flex justify-between items-center mb-8">
                      <div className="flex items-center gap-3">
                          <span className="bg-slate-950 text-slate-500 text-[10px] font-black px-4 py-1.5 rounded-full border border-white/5 tracking-[0.2em]">SEGMENTO {idx + 1}</span>
                          {scene.error && <span className="text-[9px] font-bold text-emerald-400 uppercase animate-pulse">{scene.error}</span>}
                      </div>
                      <div className="flex gap-2">
                        <button title="Generar Imagen" onClick={() => handleGenerateImage(scene)} disabled={scene.isGenerating} className="p-3 bg-white/5 rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-20 group/btn">
                            <svg className="w-4 h-4 text-white group-hover/btn:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </button>
                        <button title="Generar Video Veo" onClick={() => handleGenerateVideo(scene)} disabled={scene.isGenerating} className="p-3 bg-indigo-500/20 rounded-xl hover:bg-indigo-600 transition-all border border-indigo-500/20 disabled:opacity-20 group/btn">
                            <svg className="w-4 h-4 text-indigo-300 group-hover/btn:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        {scene.mediaUrl && (
                          <button 
                            title="Descargar Media" 
                            onClick={() => {
                              const a = document.createElement('a');
                              a.href = scene.mediaUrl!;
                              a.download = `escena-${idx + 1}-${Date.now()}.${scene.mediaType === MediaType.Video ? 'mp4' : 'png'}`;
                              a.click();
                            }} 
                            className="p-3 bg-emerald-500/10 rounded-xl hover:bg-emerald-600 transition-all border border-emerald-500/20 group/btn"
                          >
                            <svg className="w-4 h-4 text-emerald-400 group-hover/btn:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        )}
                        <button title="Eliminar Escena" onClick={() => { if(window.confirm("¿Eliminar esta escena?")) onDeleteScene(scene.id); }} className="p-3 bg-red-500/10 rounded-xl hover:bg-red-600 transition-all border border-red-500/20 group/btn">
                            <svg className="w-4 h-4 text-red-400 group-hover/btn:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="space-y-6">
                          <div className="space-y-3 bg-indigo-500/5 p-4 rounded-2xl border border-indigo-500/10">
                              <div className="flex justify-between items-center px-1">
                                  <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Duración Escena</label>
                                  <span className="text-[10px] font-mono font-bold text-white bg-indigo-500 px-3 py-1 rounded-full">{formatTime(scene.duration)}</span>
                              </div>
                              <input 
                                  type="range" 
                                  min="1" 
                                  max="1200" 
                                  step="0.5" 
                                  value={scene.duration} 
                                  onChange={e => onUpdateScene(scene.id, { duration: Number(e.target.value) })}
                                  className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
                              />
                          </div>

                          <div className="space-y-3">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-2">Narración Documental</label>
                              <textarea 
                                  className="w-full bg-slate-950/80 border border-white/5 rounded-2xl p-5 text-sm text-slate-300 outline-none focus:border-indigo-500/50 transition-all resize-none min-h-[100px]" 
                                  value={scene.script} 
                                  onChange={e => onUpdateScene(scene.id, { script: e.target.value })} 
                              />
                          </div>
                          <div className="space-y-3">
                              <label className="text-[9px] font-black text-emerald-400 uppercase tracking-widest px-2">Visual Prompt</label>
                              <textarea 
                                  className="w-full bg-slate-950/80 border border-white/5 rounded-2xl p-5 text-sm text-emerald-200/50 outline-none focus:border-emerald-500/50 transition-all resize-none min-h-[100px]" 
                                  value={scene.visualPrompt} 
                                  onChange={e => onUpdateScene(scene.id, { visualPrompt: e.target.value })} 
                              />
                          </div>
                      </div>
                      
                      <div className={`aspect-${aspectRatio === AspectRatio.Portrait ? '9/16' : '16/9'} bg-slate-950 rounded-[2rem] overflow-hidden flex items-center justify-center border border-white/5 relative group-hover:shadow-4xl transition-all`}>
                          {scene.mediaUrl ? (
                              scene.mediaType === MediaType.Video ? (
                                <video src={scene.mediaUrl} className="w-full h-full object-cover" autoPlay muted loop />
                              ) : (
                                <img src={scene.mediaUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
                              )
                          ) : (
                              <div className="flex flex-col items-center gap-5 text-center px-10">
                                  <div className={`w-14 h-14 border-2 border-emerald-500/10 border-t-emerald-500 rounded-full ${scene.isGenerating ? 'animate-spin' : 'opacity-20'} relative`}>
                                      {scene.isGenerating && scene.error?.includes('%') && (
                                          <div className="absolute inset-0 flex items-center justify-center animate-none">
                                              <span className="text-[8px] font-black text-emerald-400">{scene.error.match(/\d+%/)?.[0]}</span>
                                          </div>
                                      )}
                                  </div>
                                  <span className="text-[9px] text-slate-600 font-black uppercase tracking-[0.2em] leading-relaxed">
                                      {scene.isGenerating ? (scene.error || 'Generando contenido...') : 'Esperando turno'}
                                  </span>
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          ))}
        </div>
      ) : (
        <div className="max-w-4xl mx-auto glass-panel rounded-[3rem] p-12 border border-white/5 animate-fade-in space-y-12 shadow-4xl">
            <h3 className="text-xl font-black text-white uppercase tracking-widest text-center border-b border-white/5 pb-6">Configuración de Estilo Documental</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-6">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Arquetipo Narrativo</label>
                    <div className="grid grid-cols-1 gap-4">
                        {VOICE_OPTIONS.map(voice => (
                            <div 
                                key={voice.name}
                                onClick={() => onVoiceChange(voice.name)}
                                className={`p-6 rounded-2xl text-left transition-all border group relative cursor-pointer ${selectedVoice === voice.name ? 'bg-indigo-600 border-indigo-400 shadow-xl' : 'bg-slate-950 border-white/5 hover:border-indigo-500/50'}`}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onVoiceChange(voice.name); }}
                            >
                                <div className="flex flex-col gap-1 pr-12">
                                    <span className={`text-[11px] font-black uppercase tracking-widest ${selectedVoice === voice.name ? 'text-white' : 'text-indigo-400 group-hover:text-white'}`}>{voice.label}</span>
                                    <span className={`text-[10px] leading-snug ${selectedVoice === voice.name ? 'text-indigo-100' : 'text-slate-500'}`}>{voice.description}</span>
                                </div>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handlePreviewVoice(voice.name); }}
                                    disabled={previewingVoice === voice.name}
                                    className={`absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-all ${selectedVoice === voice.name ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400'}`}
                                >
                                    {previewingVoice === voice.name ? (
                                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                                    ) : (
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-6 pt-6 border-t border-white/5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Música de Fondo</label>
                        <div className="space-y-4">
                            <div className="flex flex-col gap-3">
                                <label className="flex items-center justify-center w-full px-4 py-3 bg-slate-950 border border-white/10 rounded-xl cursor-pointer hover:bg-indigo-500/10 hover:border-indigo-500/50 transition-all">
                                    <svg className="w-4 h-4 text-indigo-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                    </svg>
                                    <span className="text-xs text-slate-300 font-bold uppercase tracking-wider truncate">
                                        {bgMusicFile ? bgMusicFile.name : 'Subir Música'}
                                    </span>
                                    <input 
                                        type="file" 
                                        className="hidden" 
                                        accept="audio/*" 
                                        onChange={e => onMusicChange(e.target.files?.[0] || null)}
                                    />
                                </label>
                                {bgMusicFile && (
                                    <button 
                                        onClick={() => onMusicChange(null)}
                                        className="text-[9px] font-black text-red-500 uppercase tracking-widest hover:text-red-400"
                                    >
                                        Quitar Música
                                    </button>
                                )}
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Volumen Música</label>
                                    <span className="text-[10px] font-mono font-bold text-indigo-400">{Math.round(bgMusicVolume * 100)}%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="1" step="0.01" 
                                    value={bgMusicVolume} 
                                    onChange={(e) => onMusicVolChange(Number(e.target.value))}
                                    className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-8">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Subtítulos Dinámicos</label>
                        <button 
                            onClick={() => onSubStyleChange({ ...subStyle, visible: !subStyle.visible })}
                            className={`w-12 h-6 rounded-full transition-all relative ${subStyle.visible ? 'bg-indigo-600' : 'bg-slate-800'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${subStyle.visible ? 'right-1' : 'left-1'}`}></div>
                        </button>
                    </div>

                    <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Tipografía de Video</label>
                        <select 
                            value={subStyle.fontFamily}
                            onChange={(e) => onSubStyleChange({ ...subStyle, fontFamily: e.target.value })}
                            className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-indigo-500 transition-all"
                        >
                            {FONTS.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
                        </select>
                    </div>

                    <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Tipo de Animación</label>
                        <select 
                            value={subStyle.animation}
                            onChange={(e) => onSubStyleChange({ ...subStyle, animation: e.target.value as SubtitleAnimation })}
                            className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-indigo-500 transition-all"
                        >
                            <option value={SubtitleAnimation.Pop}>Pop Minimal (Viral)</option>
                            <option value={SubtitleAnimation.Typewriter}>Máquina de escribir</option>
                            <option value={SubtitleAnimation.Fade}>Desvanecimiento suave</option>
                            <option value={SubtitleAnimation.Bounce}>Rebote</option>
                            <option value={SubtitleAnimation.Glow}>Resplandor</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Color de Texto</label>
                            <input 
                                type="color" 
                                value={subStyle.textColor}
                                onChange={(e) => onSubStyleChange({ ...subStyle, textColor: e.target.value })}
                                className="w-full h-10 bg-transparent border-none cursor-pointer"
                            />
                        </div>
                        <div className="space-y-4">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Color de Énfasis</label>
                            <input 
                                type="color" 
                                value={subStyle.activeTextColor}
                                onChange={(e) => onSubStyleChange({ ...subStyle, activeTextColor: e.target.value })}
                                className="w-full h-10 bg-transparent border-none cursor-pointer"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
