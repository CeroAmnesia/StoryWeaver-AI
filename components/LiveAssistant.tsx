
import React, { useState, useRef, useEffect } from 'react';
import { createLiveSession } from '../services/geminiService';
import { Language } from '../types';
import { translations } from '../utils/translations';

interface LiveAssistantProps {
  language: Language;
}

export const LiveAssistant: React.FC<LiveAssistantProps> = ({ language }) => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const sessionRef = useRef<{ disconnect: () => Promise<void> } | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  const t = translations[language].live;

  const startSession = async () => {
    setStatus('connecting');
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    try {
      // Fix: Added audioContextRef.current! as the first argument to match the signature of createLiveSession
      const session = await createLiveSession(
        audioContextRef.current!,
        (audioBuffer) => {
          const ctx = audioContextRef.current;
          if (!ctx) return;
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          const currentTime = ctx.currentTime;
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, currentTime);
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += audioBuffer.duration;
        },
        () => {
          setIsActive(false);
          setStatus('idle');
        },
        language
      );
      sessionRef.current = session || null;
      setIsActive(true);
      setStatus('active');
    } catch (e: any) {
      console.error("Live Session Start Error:", e);
      // Ensure we clean up if start failed
      if (sessionRef.current) {
         sessionRef.current = null;
      }
      setIsActive(false);
      setStatus('error');
      // Auto-reset error status after 5s
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const stopSession = async () => {
    if (sessionRef.current) {
      try {
        await sessionRef.current.disconnect();
      } catch (e) {
        console.warn("Disconnect error:", e);
      }
      sessionRef.current = null;
    }
    setIsActive(false);
    setStatus('idle');
  };

  // Cleanup
  useEffect(() => {
    return () => {
      // Safe cleanup
      if (sessionRef.current) {
         sessionRef.current.disconnect().catch(() => {});
         sessionRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className={`glass-panel p-5 rounded-2xl transition-all duration-300 border-l-4 ${status === 'error' ? 'border-l-red-500 bg-red-900/10' : isActive ? 'border-l-rose-500 bg-rose-900/10' : 'border-l-indigo-500'}`}>
      <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className={`relative w-10 h-10 flex items-center justify-center rounded-full transition-colors ${isActive ? 'bg-rose-500/20' : 'bg-indigo-500/10'}`}>
                {isActive ? (
                   <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                   </span>
                ) : status === 'error' ? (
                   <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ) : (
                   <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                )}
            </div>
            <div>
                <h3 className="font-bold text-white text-sm">{status === 'error' ? (t.error || "Connection Failed") : t.title}</h3>
                <p className="text-xs text-slate-400">{status === 'error' ? "Service unavailable. Try again later." : t.desc}</p>
            </div>
          </div>

          <button
            onClick={isActive ? stopSession : startSession}
            disabled={status === 'connecting'}
            className={`px-5 py-2 rounded-full font-semibold text-xs transition-all shadow-lg ${
              status === 'error' 
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/20'
                : isActive 
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-500/20' 
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
            }`}
          >
            {status === 'connecting' ? (
                <span className="flex items-center space-x-2">
                   <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                   <span>{t.connect}</span>
                </span>
            ) : status === 'error' ? 'Retry' : isActive ? t.end : t.start}
          </button>
      </div>
    </div>
  );
};
