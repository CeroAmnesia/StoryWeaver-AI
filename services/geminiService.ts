import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
import { Scene, AspectRatio, Language, VisualEffect, StoryMetadata } from "../types";
import { decodeBase64, createPcmBlob, robustDecodeAudio, decodePcmData } from "../utils/audioUtils";
import { getLanguageName } from "../utils/translations";

const getApiKey = () => process.env.API_KEY || '';
const getGenAI = () => new GoogleGenAI({ apiKey: getApiKey() });

// Estilos visuales disponibles para la generación de imágenes
export const VISUAL_STYLES = [
  {
    category: 'Cinematic',
    options: [
      { id: 'cine-1', label: 'Ultra Realistic', prompt: 'Photorealistic, highly detailed, 8k, cinematic lighting, sharp focus, professional color grading' },
      { id: 'cine-2', label: 'Film Noir', prompt: 'Classic film noir, high contrast, dramatic shadows, moody atmosphere, 1940s aesthetic' },
      { id: 'cine-3', label: 'Cyberpunk', prompt: 'Futuristic cityscape, neon lights, rain-slicked streets, vibrant teal and magenta lighting' }
    ]
  },
  {
    category: 'Artistic',
    options: [
      { id: 'art-1', label: 'Oil Painting', prompt: 'Classical oil painting, visible brushstrokes, rich textures, museum quality, artistic lighting' },
      { id: 'art-2', label: 'Watercolor', prompt: 'Soft watercolor illustration, bleeding colors, delicate textures, hand-drawn feel' },
      { id: 'art-3', label: 'Pop Art', prompt: 'Vibrant pop art style, bold colors, comic book halftone patterns, high energy' }
    ]
  },
  {
    category: 'Animation',
    options: [
      { id: 'anim-1', label: 'Anime Style', prompt: 'Modern high-quality anime art style, vibrant colors, expressive lighting' },
      { id: 'anim-2', label: '3D Animation', prompt: 'Stylized 3D render, Pixar-style characters, soft shadows, warm lighting, Unreal Engine 5' },
      { id: 'anim-3', label: 'Sketch', prompt: 'Detailed pencil sketch, charcoal textures, artistic shading, hand-drawn look' }
    ]
  }
];

// Opciones de voz configuradas según los requisitos de tono, ritmo y estilo
export const VOICE_OPTIONS = [
  { 
    name: 'Viral', 
    label: 'Tono Central Urgente', 
    style: 'Rápido y dinámico (180-200 PPM), ideal para captar atención inmediata.',
    directive: 'Narrate with extreme urgency and central focus. Pace: 190 PPM. Crystal-clear energetic articulation. Polished authentic style.' 
  },
  { 
    name: 'Puck', 
    label: 'Conversacional', 
    style: 'Natural, fluido y auténtico pulido. Suena profesional pero humano.',
    directive: 'Narrate in a conversational, natural flow. Polished yet authentic human style. Pace: 180 PPM. Professional studio quality.' 
  },
  { 
    name: 'Zephyr', 
    label: 'Extremadamente Entusiasta', 
    style: 'Alta energía, vibrante y brillante. Máximo impacto emocional.',
    directive: 'Narrate with extreme enthusiasm and high energy. Vibrant and bright tone. Pace: 200 PPM. Energetic clear articulation.' 
  },
  { 
    name: 'Fenrir', 
    label: 'Profesional Autoritario', 
    style: 'Confidente y serio. Para contenido informativo o documental.',
    directive: 'Narrate with confidence and authority. Professional polished style. Pace: 180 PPM. Impeccable studio quality.' 
  }
];

const executeWithKeyRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  const maxRetries = 10; 
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      const msg = (error.message || JSON.stringify(error)).toLowerCase();
      if (msg.includes("blocked")) throw error;
      if (msg.includes("429") || msg.includes("quota") || msg.includes("503") || msg.includes("500") || msg.includes("no image generated")) {
        attempt++;
        const baseDelay = msg.includes("quota") ? 5000 : 2000;
        const delay = Math.floor(baseDelay * Math.pow(1.6, attempt)) + (Math.random() * 1000); 
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (msg.includes("requested entity was not found") || msg.includes("403")) {
        if (attempt === 0) { 
             await promptVeoKeySelection();
             attempt++;
             continue;
        }
      }
      throw error;
    }
  }
  throw new Error("Max retries reached.");
};

export const promptVeoKeySelection = async () => {
  const win = window as any;
  if (typeof win.aistudio !== 'undefined' && win.aistudio.openSelectKey) {
    await win.aistudio.openSelectKey();
  }
};

export const generateImage = async (prompt: string, aspectRatio: AspectRatio): Promise<{ url: string; base64: string; mimeType: string }> => {
  return executeWithKeyRetry(async () => {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: prompt }] },
      config: { imageConfig: { aspectRatio } }
    });
    const candidate = response.candidates?.[0];
    for (const part of candidate?.content?.parts || []) {
      if (part.inlineData) {
        const base64 = part.inlineData.data;
        const mimeType = part.inlineData.mimeType || 'image/png';
        return { url: `data:${mimeType};base64,${base64}`, base64, mimeType };
      }
    }
    throw new Error("No image generated");
  });
};

export const analyzeAndBreakdownStory = async (rawStory: string, targetDuration: number, language: Language): Promise<{ scenes: Scene[], metadata: StoryMetadata }> => {
  return executeWithKeyRetry(async () => {
    const ai = getGenAI();
    const langName = getLanguageName(language);
    const targetSceneCount = Math.max(1, Math.round(targetDuration / 10));
    
    const prompt = `Break down this story into exactly ${targetSceneCount} scenes for a total duration of ${targetDuration}s. 
    Language: ${langName}. 
    Identify the Genre, Tone and pick a narrator from the provided list based on content.
    Story: "${rawStory}"
    CRITICAL: Do not add any extra text like "subscribe" or "follow" to the scripts. Stick strictly to the story.
    Return JSON with metadata (genre, tone, recommendedVoice, consistentStyle) and scenes array (script, visualPrompt, duration).`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            metadata: {
              type: Type.OBJECT,
              properties: {
                genre: { type: Type.STRING },
                tone: { type: Type.STRING },
                recommendedVoice: { type: Type.STRING },
                consistentStyle: { type: Type.STRING }
              }
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  script: { type: Type.STRING },
                  visualPrompt: { type: Type.STRING },
                  duration: { type: Type.NUMBER }
                }
              }
            }
          }
        }
      }
    });
    const data = JSON.parse(response.text || "{}");
    const scenes = data.scenes.map((s: any, index: number) => ({
      id: `scene-${index}-${Date.now()}`,
      script: s.script,
      visualPrompt: s.visualPrompt,
      mediaType: 'image',
      duration: s.duration || (targetDuration / targetSceneCount),
      isGenerating: false,
      visualEffect: VisualEffect.ZoomIn
    }));
    return { scenes, metadata: data.metadata };
  });
};

export const generateNarration = async (text: string, language: Language, voiceName: string = 'Viral'): Promise<string> => {
  return executeWithKeyRetry(async () => {
    const ai = getGenAI();
    // Obtener la directiva específica para la voz seleccionada
    const voiceConfig = VOICE_OPTIONS.find(v => v.name === voiceName) || VOICE_OPTIONS[0];
    const styleDirective = `${voiceConfig.directive}. No forced robotic tones. Maintain crystal-clear articulation throughout. Professional studio quality: `;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: { parts: [{ text: `${styleDirective}${text}` }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  });
};

export const generateThumbnail = async (context: string, aspectRatio: AspectRatio, language: Language): Promise<string> => {
    return executeWithKeyRetry(async () => {
      const ai = getGenAI();
      const prompt = `Epic cinematic thumbnail for: ${context.substring(0, 150)}. High resolution, high contrast, matching visual style. No text.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
        config: { imageConfig: { aspectRatio } }
      });
      // Find the image part safely as per guidelines
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
      }
      return "";
    });
};

export const generateBackgroundMusic = async (prompt: string): Promise<string> => {
    return executeWithKeyRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            contents: { parts: [{ text: `Generate background music: ${prompt}. Instrumental only, no vocals.` }] },
            config: { responseModalities: [Modality.AUDIO] }
        });
        return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    });
};

export const generateStoryFromTopic = async (topic: string, targetDuration: number, language: Language, cta?: string, hook?: string): Promise<string> => {
  return executeWithKeyRetry(async () => {
    const ai = getGenAI();
    const wordCount = Math.floor(targetDuration * 2.5);
    const prompt = `Write a short story script about: "${topic}". 
    Target length: ${targetDuration}s (~${wordCount} words). Language: ${getLanguageName(language)}.
    ${hook ? `Start with: ${hook}` : ''} ${cta ? `End with: ${cta}` : ''}
    DO NOT ADD GENERIC PHRASES LIKE "FOLLOW FOR MORE" UNLESS SPECIFIED IN CTA.`;
    const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
    return response.text || "";
  });
};

export const generateVideoFromText = async (prompt: string, aspectRatio: AspectRatio): Promise<string> => {
  return executeWithKeyRetry(async () => {
    const ai = getGenAI();
    const veoRatio = aspectRatio === AspectRatio.Portrait ? '9:16' : '16:9';
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      config: { numberOfVideos: 1, resolution: '720p', aspectRatio: veoRatio }
    });
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }
    const response = await fetch(`${operation.response?.generatedVideos?.[0]?.video?.uri}&key=${getApiKey()}`);
    return URL.createObjectURL(await response.blob());
  });
};

export const animateImageWithVeo = async (prompt: string, base64: string, mimeType: string, aspectRatio: AspectRatio): Promise<string> => {
  return executeWithKeyRetry(async () => {
    const ai = getGenAI();
    const veoRatio = aspectRatio === AspectRatio.Portrait ? '9:16' : '16:9';
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      image: { imageBytes: base64, mimeType: mimeType },
      config: { numberOfVideos: 1, resolution: '720p', aspectRatio: veoRatio }
    });
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }
    const response = await fetch(`${operation.response?.generatedVideos?.[0]?.video?.uri}&key=${getApiKey()}`);
    return URL.createObjectURL(await response.blob());
  });
};

export const createLiveSession = async (
  playbackCtx: AudioContext,
  onAudioChunk: (buffer: AudioBuffer) => void,
  onClose: () => void,
  language: Language
) => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const langName = getLanguageName(language);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

  const sessionPromise = ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    callbacks: {
      onopen: () => {
        const source = inputAudioContext.createMediaStreamSource(stream);
        const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmBlob = createPcmBlob(inputData);
          sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
        };
        source.connect(scriptProcessor);
        scriptProcessor.connect(inputAudioContext.destination);
      },
      onmessage: async (msg: LiveServerMessage) => {
        const data = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (data) {
          // Gemini Live API returns raw PCM data; decode manually as per guidelines
          const buffer = await decodePcmData(decodeBase64(data), playbackCtx, 24000, 1);
          onAudioChunk(buffer);
        }
      },
      onclose: onClose,
      onerror: (e) => console.error("Live Error", e)
    },
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: `You are a creative writer helping the user write a script in ${langName}. Do not add filler social media phrases.`
    }
  });

  return {
    disconnect: async () => {
      if (inputAudioContext.state !== 'closed') inputAudioContext.close();
      stream.getTracks().forEach(t => t.stop());
    }
  };
};
