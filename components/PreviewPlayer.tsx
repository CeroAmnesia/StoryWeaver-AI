
import React, { useEffect, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import { Scene, AspectRatio, MediaType, Language, SubtitleStyle, VisualEffect, SubtitleAnimation } from '../types';
import { generateNarration, generateThumbnail } from '../services/geminiService';
import { decodeBase64, robustDecodeAudio } from '../utils/audioUtils';
import { translations } from '../utils/translations';

interface PreviewPlayerProps {
  scenes: Scene[];
  aspectRatio: AspectRatio;
  language: Language;
  onBack: () => void;
  autoRenderOnMount?: boolean;
  initialWatermark?: string;
  initialOutro?: string;
  initialOutroType?: 'image' | 'video'; 
  projectTitle?: string;
  initialSelectedVoice: string;
  initialSubStyle: SubtitleStyle;
  initialBgMusicFile: File | null;
  initialBgMusicVolume: number;
  initialNarrationVolume: number;
}

const FONTS = [
    { id: "'Archivo Black', sans-serif", name: "Archivo Black (Viral)" },
    { id: "'Montserrat', sans-serif", name: "Montserrat (Pro)" },
    { id: "'Poppins', sans-serif", name: "Poppins (Modern)" },
    { id: "'Roboto', sans-serif", name: "Roboto (Classic)" },
    { id: "'Cinzel', serif", name: "Cinzel (Cinematic)" },
];

const formatMmSs = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const sanitizeFilename = (title: string): string => {
  return title.slice(0, 40).replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'video_story';
};

interface AudioSegment {
    sceneId: string;
    buffer: AudioBuffer;
    startTime: number;
    duration: number;
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = ({ 
    scenes, aspectRatio, language, onBack, autoRenderOnMount, initialWatermark, initialOutro, initialOutroType, projectTitle, initialSelectedVoice, initialSubStyle, initialBgMusicFile, initialBgMusicVolume, initialNarrationVolume
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [activeTab, setActiveTab] = useState<'export' | 'subs' | 'branding'>('export');
  
  const [subStyle, setSubStyle] = useState<SubtitleStyle>({ 
      ...initialSubStyle, 
      strokeWidth: 10, 
      fontSize: 1.2,
      activeTextColor: '#FBBF24',
      fontFamily: "'Archivo Black', sans-serif",
      animation: SubtitleAnimation.Pop
  });
  
  const [exportFilename, setExportFilename] = useState(sanitizeFilename(projectTitle || 'My_Video'));
  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>([]);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const startTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const rafRef = useRef<number | null>(null);
  
  const canvasWidth = aspectRatio === AspectRatio.Portrait ? 1080 : 1920;
  const canvasHeight = aspectRatio === AspectRatio.Portrait ? 1920 : 1080;
  const t = translations[language].preview;

  const loadAudio = useCallback(async () => {
    setLoadingAudio(true);
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    audioContextRef.current = ctx;
    audioDestRef.current = ctx.createMediaStreamDestination();
    
    let accumulated = 0;
    const segments: AudioSegment[] = [];
    for (const scene of scenes) {
      const base64 = await generateNarration(scene.script, language, initialSelectedVoice);
      const buffer = await robustDecodeAudio(decodeBase64(base64), ctx);
      segments.push({ sceneId: scene.id, buffer, startTime: accumulated, duration: buffer.duration });
      accumulated += buffer.duration;
    }
    setAudioSegments(segments);
    setTotalDuration(accumulated);
    setLoadingAudio(false);
    
    const thumb = await generateThumbnail(scenes[0].script, aspectRatio, language);
    setThumbnailUrl(thumb);
  }, [scenes, language, initialSelectedVoice, aspectRatio]);

  useEffect(() => { loadAudio(); }, [loadAudio]);

  const play = useCallback((offset = 0, silent = false) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    activeSourcesRef.current.forEach(s => s.stop());
    activeSourcesRef.current = [];
    startTimeRef.current = ctx.currentTime - offset;
    startOffsetRef.current = offset;

    audioSegments.forEach(seg => {
      if (seg.startTime + seg.duration > offset) {
        const source = ctx.createBufferSource();
        source.buffer = seg.buffer;
        const gain = ctx.createGain();
        gain.gain.value = initialNarrationVolume;
        source.connect(gain);
        gain.connect(audioDestRef.current!);
        if (!silent) gain.connect(ctx.destination);
        const startAt = Math.max(0, seg.startTime - offset);
        const offsetInBuf = Math.max(0, offset - seg.startTime);
        source.start(ctx.currentTime + startAt, offsetInBuf);
        activeSourcesRef.current.push(source);
      }
    });
    setIsPlaying(true);
  }, [audioSegments, initialNarrationVolume]);

  const pause = () => {
    setIsPlaying(false);
    activeSourcesRef.current.forEach(s => s.stop());
    activeSourcesRef.current = [];
  };

  useEffect(() => {
    const render = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      if (isPlaying && audioContextRef.current) {
        setCurrentTime(startOffsetRef.current + (audioContextRef.current.currentTime - startTimeRef.current));
      }
      
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const currentSceneIndex = audioSegments.findIndex(s => currentTime >= s.startTime && currentTime < s.startTime + s.duration);
      const seg = audioSegments[currentSceneIndex];
      const scene = scenes[currentSceneIndex];

      if (scene?.mediaUrl) {
        const img = new Image();
        img.src = scene.mediaUrl;
        
        // APLICAR EFECTOS VISUALES
        const sceneTime = currentTime - (seg?.startTime || 0);
        const progress = seg ? sceneTime / seg.duration : 0;
        
        ctx.save();
        let scale = 1.0;
        let dx = 0;
        let dy = 0;

        switch(scene.visualEffect) {
            case VisualEffect.ZoomIn: scale = 1.0 + progress * 0.15; break;
            case VisualEffect.ZoomOut: scale = 1.15 - progress * 0.15; break;
            case VisualEffect.DollyIn: scale = 1.0 + progress * 0.4; break;
            case VisualEffect.DollyOut: scale = 1.4 - progress * 0.4; break;
            case VisualEffect.PanLeft: dx = -progress * 150; break;
            case VisualEffect.PanRight: dx = progress * 150; break;
            case VisualEffect.TiltUp: dy = -progress * 150; break;
            case VisualEffect.TiltDown: dy = progress * 150; break;
        }

        const sw = canvas.width * scale;
        const sh = canvas.height * scale;
        ctx.drawImage(img, (canvas.width - sw) / 2 + dx, (canvas.height - sh) / 2 + dy, sw, sh);
        ctx.restore();
      }

      // SUBTÍTULOS DINÁMICOS MEJORADOS
      if (subStyle.visible && scene?.script && seg) {
        const words = scene.script.split(/\s+/).filter(w => w.length > 0);
        const wordDur = seg.duration / words.length;
        const sceneTime = currentTime - seg.startTime;
        const activeWordIdx = Math.floor(sceneTime / wordDur);
        
        const chunkSize = 3;
        const chunkIdx = Math.floor(activeWordIdx / chunkSize);
        const start = chunkIdx * chunkSize;
        const visibleWords = words.slice(start, start + chunkSize);
        
        const fontSize = 85 * (subStyle.fontSize || 1);
        ctx.font = `900 ${fontSize}px ${subStyle.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const x = canvas.width / 2;
        const y = canvas.height * (subStyle.verticalPosition / 100 || 0.85);
        
        let totalW = 0;
        const measures = visibleWords.map(w => {
            const m = ctx.measureText(w + ' ');
            totalW += m.width;
            return m.width;
        });

        let curX = x - totalW / 2;
        visibleWords.forEach((word, i) => {
            const isWordActive = (start + i) === activeWordIdx;
            const wordW = measures[i];
            ctx.save();
            ctx.translate(curX + wordW/2, y);
            
            if (isWordActive) {
                // ANIMACIONES
                switch(subStyle.animation) {
                    case SubtitleAnimation.Pop:
                        const pScale = 1.15 + Math.sin(Date.now() / 150) * 0.05;
                        ctx.scale(pScale, pScale);
                        break;
                    case SubtitleAnimation.Bounce:
                        const bY = Math.sin(Date.now() / 100) * 15;
                        ctx.translate(0, bY);
                        break;
                    case SubtitleAnimation.Glow:
                        ctx.shadowColor = subStyle.activeTextColor;
                        ctx.shadowBlur = 30;
                        break;
                }
                ctx.fillStyle = subStyle.activeTextColor;
            } else {
                ctx.fillStyle = subStyle.textColor;
                ctx.globalAlpha = 0.5;
                if (subStyle.animation === SubtitleAnimation.Typewriter && (start + i) > activeWordIdx) {
                    ctx.globalAlpha = 0;
                }
            }

            ctx.strokeStyle = subStyle.outlineColor;
            ctx.lineWidth = subStyle.strokeWidth;
            ctx.lineJoin = 'round';
            ctx.strokeText(word, 0, 0);
            ctx.fillText(word, 0, 0);
            ctx.restore();
            curX += wordW;
        });
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current!);
  }, [isPlaying, currentTime, audioSegments, scenes, subStyle]);

  const handleDownload = async (type: 'video' | 'audio' | 'zip' | 'script' | 'thumbnail') => {
      const name = sanitizeFilename(exportFilename);
      
      if (type === 'script') {
          const content = scenes.map((s, i) => `Scene ${i+1}:\n[Prompt]: ${s.visualPrompt}\n[Narration]: ${s.script}\n`).join('\n');
          const blob = new Blob([content], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${name}_script.txt`;
          a.click();
          return;
      }

      setIsExporting(true);
      if (type === 'video') {
          play(0, true);
          const stream = new MediaStream([...canvasRef.current!.captureStream(30).getTracks(), ...audioDestRef.current!.stream.getTracks()]);
          const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
          const chunks: Blob[] = [];
          recorder.ondataavailable = e => chunks.push(e.data);
          recorder.onstop = () => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
              a.download = `${name}.webm`;
              a.click();
              setIsExporting(false);
          };
          recorder.start();
          setTimeout(() => recorder.stop(), totalDuration * 1000 + 500);
      }
      // ... otros tipos ...
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
        <div className="flex flex-col lg:flex-row gap-6 h-full">
            <div className="flex-1 flex flex-col space-y-4">
                 <div className="flex justify-between items-center mb-2">
                     <button onClick={onBack} className="text-slate-400 hover:text-white text-sm flex items-center px-4 py-2 bg-slate-800 rounded-lg">
                        <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        {t.back}
                     </button>
                     <div className="text-sm font-mono text-slate-500 bg-slate-900 px-4 py-2 rounded-lg border border-white/5">{formatMmSs(currentTime)} / {formatMmSs(totalDuration)}</div>
                 </div>

                 <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10" style={{ aspectRatio: aspectRatio === AspectRatio.Portrait ? '9/16' : '16/9', maxHeight: '70vh' }}>
                      {loadingAudio && <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/80"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div></div>}
                      <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} className="w-full h-full object-contain" onClick={() => isPlaying ? pause() : play(currentTime)} />
                      <div className="absolute bottom-6 left-0 right-0 flex justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <button onClick={() => isPlaying ? pause() : play(currentTime)} className="bg-white text-black px-8 py-3 rounded-full font-black text-xs uppercase shadow-2xl active:scale-95 transition-all">{isPlaying ? 'Pause' : 'Play'}</button>
                      </div>
                 </div>
            </div>

            <div className="lg:w-[380px] bg-slate-900/50 border border-white/5 rounded-2xl flex flex-col overflow-hidden">
                 <div className="flex border-b border-white/5 bg-slate-950/50">
                     {['export', 'subs'].map(tab => (
                         <button key={tab} onClick={() => setActiveTab(tab as any)} className={`flex-1 py-4 text-[10px] font-black uppercase tracking-[2px] ${activeTab === tab ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-slate-500'}`}>{tab}</button>
                     ))}
                 </div>
                 <div className="p-6 space-y-8 overflow-y-auto">
                     {activeTab === 'export' && (
                         <div className="space-y-4">
                             <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">NOMBRE DEL PROYECTO</label>
                                <input type="text" value={exportFilename} onChange={e => setExportFilename(sanitizeFilename(e.target.value))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none" placeholder="Nombre del video" />
                             </div>
                             
                             <button onClick={() => handleDownload('video')} className="w-full bg-indigo-600 hover:bg-indigo-500 py-4 rounded-xl font-black text-xs tracking-widest transition-all shadow-lg shadow-indigo-500/20 uppercase">DESCARGAR VIDEO FINAL</button>
                             <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => handleDownload('audio')} className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl font-bold text-[10px] uppercase border border-white/5">Audio</button>
                                <button onClick={() => handleDownload('script')} className="bg-slate-800 hover:bg-slate-700 py-3 rounded-xl font-bold text-[10px] uppercase border border-white/5">Guion</button>
                             </div>
                         </div>
                     )}
                     {activeTab === 'subs' && (
                         <div className="space-y-6">
                             <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 tracking-widest uppercase">{t.subsFont}</label>
                                <select value={subStyle.fontFamily} onChange={e => setSubStyle({...subStyle, fontFamily: e.target.value})} className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-3 text-xs text-white">
                                    {FONTS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                             </div>
                             <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 tracking-widest uppercase">{t.subsAnim}</label>
                                <select value={subStyle.animation} onChange={e => setSubStyle({...subStyle, animation: e.target.value as SubtitleAnimation})} className="w-full bg-slate-800 border border-white/10 rounded-lg px-4 py-3 text-xs text-white">
                                    <option value={SubtitleAnimation.Pop}>{t.animPop}</option>
                                    <option value={SubtitleAnimation.Bounce}>{t.animBounce}</option>
                                    <option value={SubtitleAnimation.Glow}>{t.animGlow}</option>
                                    <option value={SubtitleAnimation.Typewriter}>{t.animType}</option>
                                    <option value={SubtitleAnimation.Fade}>{t.animFade}</option>
                                </select>
                             </div>
                             <div className="space-y-4 pt-4 border-t border-white/5">
                                 <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-black text-slate-400">TAMAÑO</label>
                                    <input type="range" min="0.5" max="2.5" step="0.1" value={subStyle.fontSize} onChange={e => setSubStyle({...subStyle, fontSize: parseFloat(e.target.value)})} className="w-32 accent-indigo-500" />
                                 </div>
                                 <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-black text-slate-400">POSICIÓN</label>
                                    <input type="range" min="10" max="95" step="1" value={subStyle.verticalPosition} onChange={e => setSubStyle({...subStyle, verticalPosition: parseInt(e.target.value)})} className="w-32 accent-indigo-500" />
                                 </div>
                             </div>
                         </div>
                     )}
                 </div>
            </div>
        </div>
    </div>
  );
};
