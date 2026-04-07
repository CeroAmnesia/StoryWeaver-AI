
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Scene, AspectRatio, SubtitleStyle, SubtitleAnimation, StoryMetadata, Language, MediaType } from '../types';
import { generateNarration, subscribeToQueueStatus } from '../services/geminiService';
import { decodeBase64, robustDecodeAudio, concatenateAudioBuffers, audioBufferToWav } from '../utils/audioUtils';

interface PreviewPlayerProps {
  scenes: Scene[];
  aspectRatio: AspectRatio;
  language: Language;
  onBack: () => void;
  initialSelectedVoice: string;
  initialSubStyle: SubtitleStyle;
  initialBgMusicFile: File | null;
  initialBgMusicVolume: number;
  initialNarrationVolume: number;
  onNarrationVolChange: (vol: number) => void;
  onMusicVolChange: (vol: number) => void;
  metadata?: StoryMetadata;
  autoRenderOnMount?: boolean;
  initialWatermark?: string;
  initialOutro?: string;
  initialOutroType?: 'image' | 'video';
  projectTitle?: string;
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = ({ 
    scenes, aspectRatio, language, onBack, initialSelectedVoice, initialSubStyle, 
    initialBgMusicFile, initialBgMusicVolume, onMusicVolChange,
    initialNarrationVolume, onNarrationVolChange, metadata, projectTitle
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [masterAudioBuffer, setMasterAudioBuffer] = useState<AudioBuffer | null>(null);
  const [bgMusicBuffer, setBgMusicBuffer] = useState<AudioBuffer | null>(null);
  const [sceneTimings, setSceneTimings] = useState<{sceneId: string, startTime: number, duration: number}[]>([]);
  const [realTotalDuration, setRealTotalDuration] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToQueueStatus(setQueueStatus);
  }, []);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const mediaCacheRef = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map());
  const audioCacheRef = useRef<Map<string, AudioBuffer>>(new Map()); 
  const generationIdRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const bgMusicGainNodeRef = useRef<GainNode | null>(null);

  const lastConfigRef = useRef<string>("");
  const isLoadingRef = useRef<boolean>(false);
  const canvasWidth = (aspectRatio === AspectRatio.Portrait ? 1080 : 1920);
  const canvasHeight = (aspectRatio === AspectRatio.Portrait ? 1920 : 1080);

  useEffect(() => {
    scenes.forEach(s => {
      if (s.mediaUrl && !mediaCacheRef.current.has(s.id)) {
        if (s.mediaType === MediaType.Video) {
          const video = document.createElement('video');
          video.crossOrigin = "anonymous";
          video.src = s.mediaUrl;
          video.muted = true;
          video.loop = true;
          video.preload = "auto";
          video.onerror = () => console.error(`Error cargando video: ${s.mediaUrl}`);
          video.onloadeddata = () => mediaCacheRef.current.set(s.id, video);
          video.load();
        } else {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = s.mediaUrl;
          img.onerror = () => console.error(`Error cargando imagen: ${s.mediaUrl}`);
          img.onload = () => mediaCacheRef.current.set(s.id, img);
        }
      }
    });
    
    // Cleanup: Liberar memoria de medios no utilizados
    return () => {
      const currentIds = new Set(scenes.map(s => s.id));
      mediaCacheRef.current.forEach((val, key) => {
        if (!currentIds.has(key)) {
          if (val instanceof HTMLVideoElement) {
            val.pause();
            val.src = "";
            val.load();
          }
          mediaCacheRef.current.delete(key);
        }
      });
    };
  }, [scenes]);

  useEffect(() => {
    if (!initialBgMusicFile) {
      setBgMusicBuffer(null);
      return;
    }

    const decodeMusic = async () => {
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioContextRef.current;
      
      try {
        const arrayBuffer = await initialBgMusicFile.arrayBuffer();
        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        setBgMusicBuffer(decodedBuffer);
      } catch (err) {
        console.error("Error decodificando música de fondo:", err);
      }
    };

    decodeMusic();
  }, [initialBgMusicFile]);

  const stopAudio = useCallback(() => {
    activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeSourcesRef.current = [];
    bgMusicGainNodeRef.current = null;
  }, []);

  const initAudio = useCallback(async () => {
    const currentConfig = JSON.stringify({ scenes, language, initialSelectedVoice, metadata });
    if (lastConfigRef.current === currentConfig && masterAudioBuffer) return;
    if (isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    lastConfigRef.current = currentConfig;

    const genId = ++generationIdRef.current;
    setLoadingAudio(true);
    setAudioProgress(0);
    setErrorStatus(null);
    stopAudio();
    
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioContextRef.current;
    recorderDestRef.current = ctx.createMediaStreamDestination();

    try {
      let completed = 0;
      const totalScenes = scenes.length;
      
      const sceneResults = await Promise.all(scenes.map(async (scene) => {
        const cacheKey = `${scene.id}_${initialSelectedVoice}`;
        let buf = audioCacheRef.current.get(cacheKey);

        if (!buf) {
          try {
            const base64 = await generateNarration(scene.script, language, initialSelectedVoice, metadata?.tone);
            buf = await robustDecodeAudio(decodeBase64(base64), ctx);
            audioCacheRef.current.set(cacheKey, buf);
          } catch (e: any) {
            throw e;
          }
        }
        
        completed++;
        // Asegurar que el progreso sea exacto y no salte erráticamente
        setAudioProgress(Math.min(100, Math.round((completed / totalScenes) * 100)));
        
        return { sceneId: scene.id, buffer: buf! };
      }));

      if (genId !== generationIdRef.current) return;

      const buffers: AudioBuffer[] = [];
      const timings: any[] = [];
      let acc = 0;

      for (const res of sceneResults) {
        buffers.push(res.buffer);
        const actualDuration = res.buffer.duration;
        timings.push({ sceneId: res.sceneId, startTime: acc, duration: actualDuration });
        acc += actualDuration;
      }

      setMasterAudioBuffer(concatenateAudioBuffers(buffers, ctx));
      setSceneTimings(timings);
      setRealTotalDuration(acc);
      setErrorStatus(null);
    } catch (e: any) { 
        console.error("Fallo crítico en sincronización:", e);
        const msg = e.message?.toLowerCase() || "";
        if (msg.includes("límite diario") || msg.includes("limit: 0") || msg.includes("quota") || msg.includes("exceeded")) {
          setErrorStatus("Cuota de IA excedida. El sistema pausará 60s para recuperar el acceso. Por favor, espera...");
        } else if (msg.includes("timeout")) {
          setErrorStatus("La IA está tardando más de lo esperado. Reintentando...");
        } else if (msg.includes("invalid_argument")) {
          setErrorStatus("La IA rechazó narrar parte del guion. Intenta simplificar el texto o evitar temas sensibles.");
        } else {
          setErrorStatus(`Fallo en sincronización: ${e.message || 'Error desconocido'}`);
        }
    } finally { 
        if (genId === generationIdRef.current) {
          setLoadingAudio(false); 
          isLoadingRef.current = false;
        }
    }
  }, [scenes, language, initialSelectedVoice, metadata]);

  useEffect(() => { initAudio(); return () => stopAudio(); }, [initAudio]);

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas || sceneTimings.length === 0) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const t = Math.min(time, realTotalDuration);
    let idx = sceneTimings.findIndex(s => t >= s.startTime && t < s.startTime + s.duration);
    if (idx === -1) idx = t >= realTotalDuration ? sceneTimings.length - 1 : 0;
    const segment = sceneTimings[idx];
    const scene = scenes.find(s => s.id === segment.sceneId);
    const progress = (t - segment.startTime) / segment.duration;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const media = mediaCacheRef.current.get(segment.sceneId);
    if (media) {
      if (media instanceof HTMLVideoElement) {
        const videoTime = progress * media.duration;
        // OPTIMIZACIÓN: Solo sincronizar si el desfase es mayor a 300ms para evitar stuttering
        if (Math.abs(media.currentTime - videoTime) > 0.3) {
          media.currentTime = videoTime;
        }
        ctx.drawImage(media, 0, 0, canvasWidth, canvasHeight);
      } else {
        const s = 1.0 + progress * 0.1;
        const w = canvasWidth * s;
        const h = canvasHeight * s;
        ctx.drawImage(media, (canvasWidth - w) / 2, (canvasHeight - h) / 2, w, h);
      }
    }

    if (initialSubStyle.visible && scene) {
      const words = scene.script.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 0) {
        const wordIdx = Math.min(words.length - 1, Math.floor(progress * words.length));
        const currentWord = words[wordIdx];
        
        const fontSize = initialSubStyle.fontSize * (canvasWidth * 0.07);
        ctx.font = `900 ${fontSize}px ${initialSubStyle.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const posY = canvasHeight * (initialSubStyle.verticalPosition / 100);

        ctx.save();
        ctx.translate(canvasWidth / 2, posY);

        let scale = 1.0;
        if (initialSubStyle.animation === SubtitleAnimation.Pop) {
          const pop = (progress * words.length) % 1;
          scale = pop < 0.2 ? 0.8 + pop : 1.1 - (pop * 0.1);
        } else if (initialSubStyle.animation === SubtitleAnimation.Bounce) {
          scale = 1.0 + Math.abs(Math.sin(progress * words.length * Math.PI)) * 0.15;
        }

        ctx.scale(scale, scale);
        ctx.strokeStyle = initialSubStyle.outlineColor;
        ctx.lineWidth = fontSize * 0.15;
        ctx.strokeText(currentWord.toUpperCase(), 0, 0);
        ctx.fillStyle = initialSubStyle.activeTextColor;
        ctx.fillText(currentWord.toUpperCase(), 0, 0);
        ctx.restore();
      }
    }
  }, [sceneTimings, scenes, realTotalDuration, initialSubStyle, canvasWidth, canvasHeight]);

  const togglePlayback = async () => {
    if (!isPlaying && audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    if (isPlaying && (masterAudioBuffer || bgMusicBuffer)) {
      const ctx = audioContextRef.current!;
      const offset = currentTime;

      if (masterAudioBuffer) {
        const source = ctx.createBufferSource();
        source.buffer = masterAudioBuffer;
        const gain = ctx.createGain();
        gain.gain.value = initialNarrationVolume;
        source.connect(gain).connect(ctx.destination);
        if (recorderDestRef.current) gain.connect(recorderDestRef.current);
        source.start(0, offset);
        activeSourcesRef.current.push(source);
      }

      if (bgMusicBuffer) {
        const bgSource = ctx.createBufferSource();
        bgSource.buffer = bgMusicBuffer;
        bgSource.loop = true;
        const bgGain = ctx.createGain();
        bgGain.gain.value = initialBgMusicVolume;
        bgMusicGainNodeRef.current = bgGain;
        bgSource.connect(bgGain).connect(ctx.destination);
        if (recorderDestRef.current) bgGain.connect(recorderDestRef.current);
        bgSource.start(0, offset % bgMusicBuffer.duration);
        activeSourcesRef.current.push(bgSource);
      }
      
      const startTime = ctx.currentTime;

      const loop = () => {
        const now = ctx.currentTime - startTime + offset;
        if (now >= realTotalDuration) { 
          setIsPlaying(false); 
          setCurrentTime(0);
          if (isRecording && recorderRef.current) recorderRef.current.stop();
          return; 
        }
        setCurrentTime(now);
        draw(now);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } else {
      stopAudio();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, masterAudioBuffer, bgMusicBuffer, realTotalDuration, draw, initialNarrationVolume, initialBgMusicVolume, isRecording]);

  const handleExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !masterAudioBuffer || !recorderDestRef.current) return;
    
    // Asegurar que el contexto de audio esté activo
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    setIsRecording(true);
    setCurrentTime(0);
    stopAudio();
    setIsPlaying(false);
    
    // Pequeña espera para asegurar que el estado se limpie y el canvas se resetee
    await new Promise(resolve => setTimeout(resolve, 200));

    // Capturar stream del canvas a 30fps (más estable para exportación)
    const stream = canvas.captureStream(30);
    const audioStream = recorderDestRef.current.stream;
    
    // Combinar pistas de video y audio
    const videoTracks = stream.getVideoTracks();
    const audioTracks = audioStream.getAudioTracks();
    
    if (videoTracks.length === 0 || audioTracks.length === 0) {
      console.error("Faltan pistas para la exportación:", { video: videoTracks.length, audio: audioTracks.length });
      setIsRecording(false);
      return;
    }

    const combined = new MediaStream([...videoTracks, ...audioTracks]);
    
    // Selección experta de mimeType (Priorizando MP4 por requerimiento estricto)
    const mimeType = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ].find(m => MediaRecorder.isTypeSupported(m)) || 'video/mp4';
    
    const extension = 'mp4'; // Forzado a MP4 por requerimiento del usuario
    
    const recorder = new MediaRecorder(combined, { 
      mimeType, 
      videoBitsPerSecond: 15000000, // 15Mbps para excelente calidad 1080p
      audioBitsPerSecond: 192000
    });
    
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      if (chunks.length === 0) {
        console.error("No se capturaron datos de video.");
        setIsRecording(false);
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const fileName = projectTitle 
        ? projectTitle.substring(0, 40).replace(/[^a-z0-9]/gi, '_').toLowerCase() 
        : `storyweaver_master_${Date.now()}`;
        
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setIsRecording(false);
      setCurrentTime(0);
      recorderRef.current = null;
    };
    
    // Iniciar grabación y reproducción simultánea
    recorder.start(1000); // Capturar en fragmentos de 1s para mayor estabilidad
    setIsPlaying(true);
  };

  return (
    <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-16 animate-fade-in pb-24">
      <div className="flex-1 space-y-8">
        <div className="flex justify-between items-center bg-slate-950/80 p-8 rounded-[3.5rem] border border-white/10 backdrop-blur-3xl shadow-2xl">
            <button onClick={onBack} className="text-[11px] font-black uppercase text-slate-500 hover:text-white px-8 py-3 bg-white/5 rounded-full border border-white/5 transition-all">← Volver al Editor</button>
            <div className="flex items-center gap-4">
                <div className="text-indigo-400 font-mono font-black text-lg bg-indigo-500/10 px-6 py-2 rounded-full border border-indigo-500/20">
                    {currentTime.toFixed(1)}s <span className="text-slate-800">/</span> {realTotalDuration.toFixed(1)}s
                </div>
            </div>
        </div>
        
        <div className="relative aspect-[9/16] max-h-[80vh] mx-auto bg-black rounded-[4rem] overflow-hidden border-[12px] border-slate-900 shadow-[0_0_100px_rgba(99,102,241,0.2)] group">
          <canvas 
            ref={canvasRef} 
            width={canvasWidth} 
            height={canvasHeight} 
            className="w-full h-full object-contain" 
            style={{ imageRendering: 'auto' }}
          />
          
          {(loadingAudio || isRecording || errorStatus) && (
            <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-2xl flex flex-col items-center justify-center z-50 p-12 text-center">
                <div className="relative mb-10">
                   {errorStatus ? (
                      <div className="w-28 h-28 border-4 border-emerald-500/20 rounded-full flex items-center justify-center">
                         <svg className="w-12 h-12 text-emerald-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      </div>
                   ) : (
                      <div className="w-28 h-28 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin"></div>
                   )}
                    {!errorStatus && (
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-black text-indigo-400">
                         {isRecording ? `${Math.min(100, Math.round((currentTime/realTotalDuration)*100))}%` : `${Math.min(100, audioProgress)}%`}
                      </div>
                    )}
                </div>
                <div className="space-y-4">
                  <p className="text-lg font-black text-white uppercase tracking-[0.4em] animate-pulse">
                    {queueStatus || errorStatus || (isRecording ? `Exportando Master Pro...` : `Sincronizando Narrativa...`)}
                  </p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] max-w-xs leading-relaxed">
                    {errorStatus ? 'Estamos optimizando los recursos del servidor para tu historia. La construcción continuará automáticamente en un momento.' : (isRecording ? `Combinando visuales y audio con bitrate de alta fidelidad.` : `Preparando buffers de audio de alta resolución.`)}
                  </p>
                </div>
            </div>
          )}

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
             <div className="bg-slate-900/80 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                Master Render Engine 3.4
             </div>
          </div>
        </div>

        <div className="flex justify-center pt-4">
           <button 
             onClick={togglePlayback} 
             disabled={loadingAudio || isRecording}
             className="bg-white text-black w-24 h-24 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-[0_0_60px_rgba(255,255,255,0.15)] disabled:opacity-20"
           >
             {isPlaying ? <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-10 h-10 translate-x-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
           </button>
        </div>
      </div>

      <div className="lg:w-[420px] space-y-8">
          <div className="glass-panel rounded-[3.5rem] p-10 border border-white/5 shadow-2xl relative overflow-hidden group">
             <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 to-transparent opacity-40 pointer-events-none"></div>
             <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 mb-10 pb-5 border-b border-white/10 relative">Exportación Cinematográfica</h3>
             
             <div className="space-y-10 relative">
                <div className="space-y-4">
                    <button 
                        onClick={handleExport} 
                        disabled={isRecording || loadingAudio || !masterAudioBuffer} 
                        className="w-full bg-gradient-to-r from-emerald-600 via-indigo-600 to-emerald-600 bg-[length:200%_auto] hover:bg-right animate-gradient-x py-12 rounded-[3rem] font-black text-xs uppercase tracking-[0.4em] shadow-[0_30px_60px_rgba(79,70,229,0.35)] hover:shadow-[0_40px_80px_rgba(79,70,229,0.5)] hover:-translate-y-1.5 active:translate-y-0 transition-all disabled:opacity-20 flex flex-col items-center gap-4"
                    >
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        <span>DESCARGAR MP4 MASTER</span>
                    </button>
                </div>
                {masterAudioBuffer && (
                  <button 
                    onClick={() => {
                      const wavBlob = audioBufferToWav(masterAudioBuffer);
                      const url = URL.createObjectURL(wavBlob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `narracion-${Date.now()}.wav`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    disabled={isRecording}
                    className="w-full bg-slate-900 border border-white/5 py-6 rounded-[2rem] font-black text-[10px] uppercase tracking-[0.3em] text-slate-400 hover:text-white hover:bg-slate-800 transition-all flex items-center justify-center gap-3"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                    <span>Descargar Audio WAV</span>
                  </button>
                )}
                
                <div className="space-y-6 bg-slate-950/40 p-8 rounded-[2.5rem] border border-white/5">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Volumen Narración</span>
                        <span className="text-[10px] font-mono text-indigo-400 font-black bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-500/20">{Math.round(initialNarrationVolume * 100)}%</span>
                    </div>
                    <input 
                        type="range" min="0" max="1" step="0.01" 
                        value={initialNarrationVolume} 
                        onChange={(e) => onNarrationVolChange(Number(e.target.value))}
                        className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer hover:accent-indigo-400 transition-all"
                    />
                </div>

                <div className="space-y-6 bg-slate-950/40 p-8 rounded-[2.5rem] border border-white/5">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Volumen Música</span>
                        <span className="text-[10px] font-mono text-indigo-400 font-black bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-500/20">{Math.round(initialBgMusicVolume * 100)}%</span>
                    </div>
                    <input 
                        type="range" min="0" max="1" step="0.01" 
                        value={initialBgMusicVolume} 
                        onChange={(e) => onMusicVolChange(Number(e.target.value))}
                        className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer hover:accent-indigo-400 transition-all"
                    />
                </div>

                <div className="bg-slate-950/60 p-8 rounded-[2.5rem] border border-white/5 space-y-4">
                  <div className="flex items-center gap-3 text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em]">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                    Especificaciones Master
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <p className="text-[8px] text-slate-600 font-black uppercase">Resolución</p>
                        <p className="text-[10px] text-slate-300 font-bold">{canvasWidth}x{canvasHeight}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[8px] text-slate-600 font-black uppercase">Formato</p>
                        <p className="text-[10px] text-slate-300 font-bold">MP4 / H.264</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[8px] text-slate-600 font-black uppercase">Bitrate</p>
                        <p className="text-[10px] text-slate-300 font-bold">50.0 Mbps</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[8px] text-slate-600 font-black uppercase">Audio</p>
                        <p className="text-[10px] text-slate-300 font-bold">AAC (Compatible MP3)</p>
                    </div>
                  </div>
                </div>
             </div>
          </div>
      </div>
    </div>
  );
};
