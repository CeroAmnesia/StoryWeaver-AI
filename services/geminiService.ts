
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Scene, AspectRatio, Language, StoryMetadata, MediaType, VisualEffect } from "../types";
import { decodeBase64, encodeBase64, createPcmBlob, decodePcmData, robustDecodeAudio, concatenateAudioBuffers } from "../utils/audioUtils";
import { getLanguageName } from "../utils/translations";
import { aiCache } from "./aiCache";

const getApiKey = () => {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  if (!key) console.warn("[GeminiService] No se encontró clave API en las variables de entorno.");
  return key;
};
const getAIInstance = () => new GoogleGenAI({ apiKey: getApiKey() });

/**
 * APIQueue: Motor de gestión de tráfico con control de saturación.
 * Diseñado para maximizar el rendimiento bajo límites de cuota estrictos.
 */
class APIQueue {
  private queue: Array<{task: () => Promise<any>, resolve: (v: any) => void, reject: (e: any) => void}> = [];
  private processing = 0;
  private maxConcurrent: number;
  private isPaused = false;
  private taskDelay: number;
  private defaultRecoveryPause = 30000; // Reducido a 30s para que el usuario no piense que se colgó
  private onStatusChange?: (status: string | null) => void;

  constructor(maxConcurrent = 1, taskDelay = 1000, onStatusChange?: (status: string | null) => void) {
    this.maxConcurrent = maxConcurrent;
    this.taskDelay = taskDelay;
    this.onStatusChange = onStatusChange;
  }

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  private async process() {
    if (this.isPaused || this.processing >= this.maxConcurrent || this.queue.length === 0) return;
    
    this.processing++;
    const { task, resolve, reject } = this.queue.shift()!;
    
    try {
      const result = await task();
      resolve(result);
    } catch (error: any) {
      const errorMsg = error.message?.toLowerCase() || "";
      const isQuotaError = 
        errorMsg.includes("429") || 
        errorMsg.includes("quota") || 
        errorMsg.includes("limit") || 
        errorMsg.includes("too many requests") || 
        errorMsg.includes("exhausted") ||
        errorMsg.includes("rate") ||
        errorMsg.includes("superó la cuota") ||
        errorMsg.includes("reintentar") ||
        errorMsg.includes("later");

      if (isQuotaError || errorMsg.includes("overloaded") || errorMsg.includes("503") || errorMsg.includes("deadline")) {
        let customDelay = this.defaultRecoveryPause;
        
        try {
          const retryMatch = error.message.match(/retry in ([\d.]+)s/i) || error.message.match(/retrydelay["']?\s*:\s*["']?(\d+)s/i);
          if (retryMatch && retryMatch[1]) {
            const seconds = parseFloat(retryMatch[1]);
            customDelay = (Math.ceil(seconds) + 2) * 1000;
          } else {
            const errorJson = JSON.parse(error.message);
            const details = errorJson.error?.details || [];
            const retryInfo = details.find((d: any) => 
              d['@type']?.toLowerCase().includes('retryinfo') || 
              d.retrydelay || 
              d.retryDelay
            );
            const delayStr = retryInfo?.retrydelay || retryInfo?.retryDelay;
            if (delayStr) {
              const seconds = parseInt(delayStr.replace('s', ''));
              if (!isNaN(seconds)) {
                customDelay = (seconds + 2) * 1000;
              }
            }
          }
        } catch (e) {}

        console.warn(`[APIQueue] Saturación detectada. Pausando cola por ${customDelay/1000}s.`);
        this.onStatusChange?.(`Cuota excedida. Esperando ${Math.ceil(customDelay/1000)}s...`);
        this.queue.unshift({ task, resolve, reject });
        this.pauseQueue(customDelay);
      } else {
        reject(error);
      }
    } finally {
      this.processing--;
      setTimeout(() => this.process(), this.taskDelay);
    }
  }

  private pauseQueue(delay?: number) {
    if (this.isPaused) return;
    this.isPaused = true;
    const pauseTime = delay || this.defaultRecoveryPause;
    setTimeout(() => {
      this.isPaused = false;
      this.onStatusChange?.(null);
      this.process();
    }, pauseTime);
  }
}

// Sistema de escucha para estados de cola
type QueueStatusListener = (status: string | null) => void;
const listeners: Set<QueueStatusListener> = new Set();

export const subscribeToQueueStatus = (listener: QueueStatusListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notifyListeners = (status: string | null) => {
  listeners.forEach(l => l(status));
};

// Instancias de colas especializadas por tipo de recurso
const queues = {
  text: new APIQueue(1, 1000, notifyListeners),   // Reducida concurrencia para ser más respetuoso con la cuota
  image: new APIQueue(1, 3000, notifyListeners),  
  video: new APIQueue(1, 1000, notifyListeners),
};

export const promptVeoKeySelection = async (): Promise<boolean> => {
  if (typeof window !== 'undefined' && (window as any).aistudio) {
    try {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
        return false;
      }
      return true;
    } catch (e) {
      console.error("Error selection key:", e);
      return false;
    }
  }
  return true;
};

/**
 * executeSafeAI: Wrapper resiliente para llamadas a la IA.
 * Implementa timeouts, reintentos exponenciales y gestión de colas.
 */
const executeSafeAI = async <T>(operation: (ai: GoogleGenAI) => Promise<T>, type: 'text' | 'image' | 'video' = 'text'): Promise<T> => {
  const queue = queues[type];
  return queue.add(async () => {
    let attempt = 0;
    const maxRetries = 5; 
    
    while (attempt < maxRetries) {
      try {
        const ai = getAIInstance();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Timeout de IA (90s)")), 90000)
        );
        return await Promise.race([operation(ai), timeoutPromise]) as T;
      } catch (error: any) {
        attempt++;
        const errorMsg = error.message?.toLowerCase() || "";
        
        // Log detallado para errores 400/Argumentos inválidos o 403/Permisos
        if (errorMsg.includes("invalid_argument") || errorMsg.includes("400") || errorMsg.includes("permission") || errorMsg.includes("403")) {
          console.error(`[GeminiService] Error crítico de API:`, error.message);
          
          // Si es un error de permisos, intentamos forzar la selección de llave si es posible
          if (errorMsg.includes("permission") || errorMsg.includes("403")) {
            promptVeoKeySelection();
          }
          
          // NO reintentar errores de permisos o argumentos (no son transitorios)
          throw error;
        }
        
        // Si es error de cuota, lo lanzamos para que la cola lo maneje pausándose
        const isQuotaError = 
          errorMsg.includes("429") || 
          errorMsg.includes("quota") || 
          errorMsg.includes("limit") || 
          errorMsg.includes("exhausted") ||
          errorMsg.includes("superó la cuota") ||
          errorMsg.includes("too many requests") ||
          errorMsg.includes("reintentar") ||
          errorMsg.includes("later");
        
        if (isQuotaError || errorMsg.includes("overloaded") || errorMsg.includes("503") || errorMsg.includes("deadline")) {
          throw error; 
        }

        const isRetryable = errorMsg.includes("500") || errorMsg.includes("503") || errorMsg.includes("fetch") || errorMsg.includes("deadline") || errorMsg.includes("network") || errorMsg.includes("overloaded") || errorMsg.includes("timeout");
        if (!isRetryable || attempt >= maxRetries) throw error;
        
        const delay = (2000 * attempt) + (Math.random() * 1000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error("El servidor está ocupado. La tarea se ha re-encolado automáticamente.");
  });
};

export const generateNarration = async (text: string, language: Language, voiceName = 'Fenrir', tone?: string): Promise<string> => {
  if (!text || !text.trim()) return "";
  
  const cacheKey = aiCache.generateKey('tts', `${voiceName}_${text}`);
  const cached = aiCache.get<string>(cacheKey);
  if (cached) return cached;

  // Dividir en fragmentos más grandes para reducir llamadas a la API
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";
  
  for (const sentence of sentences) {
    if ((currentChunk.length + sentence.length) > 1200) {
      chunks.push(currentChunk);
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  const audioParts: Uint8Array[] = await Promise.all(
    chunks.map(chunk => executeSafeAI(async (ai) => {
      const voiceMeta = VOICE_OPTIONS.find(v => v.name === voiceName);
      const cleanText = chunk.trim();
      
      if (!cleanText) return new Uint8Array(0);

      try {
        // Intento 1: Con systemInstruction (más robusto para evitar que la IA "charle")
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-preview-tts',
          contents: [{ parts: [{ text: cleanText }] }],
          config: {
            systemInstruction: `You are a professional text-to-speech engine. Narrate the provided text exactly as written in ${getLanguageName(language)}. Tone: ${tone || 'Engaging'}. Style: ${voiceMeta?.style || 'Natural delivery'}. DO NOT add any commentary, only output audio.`,
            responseModalities: [Modality.AUDIO],
            speechConfig: { 
              voiceConfig: { 
                prebuiltVoiceConfig: { 
                  voiceName: voiceName as any 
                } 
              } 
            },
          },
        });

        const candidate = response.candidates?.[0];
        const data = candidate?.content?.parts.find(p => p.inlineData)?.inlineData?.data;
        
        if (data) return decodeBase64(data);
        
        // Si no hay audio pero hay texto, es un "refusal" o respuesta no-audio
        const textPart = candidate?.content?.parts.find(p => p.text)?.text;
        if (textPart) {
          console.warn("[TTS] La IA devolvió texto en lugar de audio:", textPart);
          throw new Error("INVALID_ARGUMENT: model returned non-audio response");
        }
        
        throw new Error(`Fallo en parte de audio TTS: ${candidate?.finishReason || 'Sin datos'}`);
      } catch (error: any) {
        const msg = error.message?.toLowerCase() || "";
        
        // Reintento de emergencia: Prompt ultra-simplificado si el anterior falló por argumentos
        if (msg.includes("invalid_argument") || msg.includes("non-audio")) {
          console.warn("[TTS] Reintentando con prompt minimalista...");
          const fallbackResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: `Say: ${cleanText}` }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: { 
                voiceConfig: { 
                  prebuiltVoiceConfig: { 
                    voiceName: voiceName as any 
                  } 
                } 
              },
            },
          });
          
          const fallbackData = fallbackResponse.candidates?.[0]?.content?.parts.find(p => p.inlineData)?.inlineData?.data;
          if (fallbackData) return decodeBase64(fallbackData);
        }
        
        throw error;
      }
    }, 'text'))
  );

  // Concatenar Uint8Arrays
  const totalLength = audioParts.reduce((acc, val) => acc + val.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of audioParts) {
    combined.set(part, offset);
    offset += part.length;
  }

  const finalBase64 = encodeBase64(combined);
  aiCache.set(cacheKey, finalBase64);
  return finalBase64;
};

/**
 * generateImage: Genera imágenes fotorrealistas con Gemini 2.5 Flash Image.
 */
export const generateImage = async (prompt: string, aspectRatio: AspectRatio, userStylePrompt?: string, dna?: string): Promise<{ url: string; base64: string; mimeType: string }> => {
  const cacheKey = aiCache.generateKey('img', `${prompt}_${aspectRatio}_${userStylePrompt}`);
  const cached = aiCache.get<{ url: string; base64: string; mimeType: string }>(cacheKey);
  if (cached) return cached;

  const result = await executeSafeAI(async (ai) => {
    const finalPrompt = `
      PHOTO: ${prompt}.
      DNA: ${dna || 'High realism'}.
      STYLE: ${userStylePrompt || VISUAL_STYLES[0].options[0].prompt}.
      SUBJECT: Living human, high fidelity textures.
      NEGATIVE: statue, plastic, stone, mannequin, fake.
    `.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: finalPrompt }] },
      config: { imageConfig: { aspectRatio } }
    });
    
    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    if (!part?.inlineData) throw new Error("Error en generación de imagen: No se recibieron datos");
    
    return { 
      url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, 
      base64: part.inlineData.data, 
      mimeType: part.inlineData.mimeType 
    };
  }, 'image');

  aiCache.set(cacheKey, result);
  return result;
};

/**
 * generateVideo: Genera videos cinemáticos con Veo 3.1.
 */
export const generateVideo = async (prompt: string, aspectRatio: AspectRatio, onProgress?: (msg: string) => void, base64Image?: string): Promise<{ url: string; mimeType: string }> => {
  let progress = 5;
  onProgress?.(`Iniciando: ${progress}%`);
  
  const enhancedPrompt = `
    CINEMATIC VIDEO: ${prompt}. 
    Hyper-realistic human movements. Strict period accuracy. 
    Maintain character identity and visual atmosphere.
  `.trim();

  let operation = await executeSafeAI(async (ai) => {
    progress = 10;
    onProgress?.(`Preparando: ${progress}%`);
    return await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview', 
      prompt: enhancedPrompt,
      image: base64Image ? {
        imageBytes: base64Image,
        mimeType: 'image/png'
      } : undefined,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: aspectRatio === AspectRatio.Portrait ? '9:16' : '16:9'
      }
    });
  }, 'video');

  while (!operation.done) {
    progress = Math.min(95, progress + Math.floor(Math.random() * 15) + 5);
    onProgress?.(`Renderizando: ${progress}%`);
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    try {
      const currentOp = operation;
      operation = await executeSafeAI(async (ai) => {
        return await ai.operations.getVideosOperation({ operation: currentOp });
      }, 'video');
    } catch (e: any) {
      const msg = e.message?.toLowerCase() || "";
      if (msg.includes("quota") || msg.includes("429") || msg.includes("limit")) {
        onProgress?.(`Cola de espera: ${progress}%`);
        continue;
      }
      throw e;
    }
  }

  onProgress?.(`Finalizando: 100%`);

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) throw new Error("Error al obtener descarga de video");

  const response = await executeSafeAI(async () => {
    return await fetch(downloadLink, {
      method: 'GET',
      headers: {
        'x-goog-api-key': getApiKey(),
      },
    });
  }, 'video');
  
  if (!response.ok) throw new Error(`Error descargando video: ${response.statusText}`);
  
  const blob = await response.blob();
  return {
    url: URL.createObjectURL(blob),
    mimeType: blob.type
  };
};

/**
 * analyzeAndBreakdownStory: Desglosa una historia en escenas visuales.
 */
export const analyzeAndBreakdownStory = async (rawStory: string, targetDuration: number, language: Language): Promise<{ scenes: Scene[], metadata: StoryMetadata }> => {
  return executeSafeAI(async (ai) => {
    const averageSceneDuration = 8;
    const maxScenes = 20;
    const sceneCount = Math.min(maxScenes, Math.max(4, Math.ceil(targetDuration / averageSceneDuration)));

    const prompt = `
      TASK: Convert this story into a ${sceneCount}-scene high-dynamism cinematic breakdown: ${rawStory}. 
      Language: ${getLanguageName(language)}. 
      
      STRICT CONSTRAINTS:
      1. TOTAL DURATION: Sum of all scene durations MUST be EXACTLY ${targetDuration} seconds.
      2. VISUAL DYNAMISM: Target 5 to 8 seconds per scene.
      3. SCRIPT-SYNC ACCURACY: The length of each 'script' MUST match its 'duration' at a natural pace.
          - FORMULA: Calculate exactly 2.4 words per second of duration. 
      4. VISUAL CONSISTENCY: Define 'consistentStyle' for physical DNA and lighting.
      
      Return JSON only.
    `.trim();

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

    const text = response.text;
    if (!text) throw new Error("La IA no devolvió contenido para el desglose.");

    try {
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleanJson);
      
      return {
        metadata: data.metadata,
        scenes: data.scenes.map((s: any, i: number) => ({
          id: `sc-${i}-${Date.now()}`,
          script: s.script,
          visualPrompt: s.visualPrompt,
          duration: s.duration || 6, 
          mediaType: MediaType.Image,
          isGenerating: false,
          visualEffect: VisualEffect.ZoomIn
        }))
      };
    } catch (parseError) {
      throw new Error("Error al procesar la estructura de la historia. Inténtalo de nuevo.");
    }
  }, 'text');
};

/**
 * generateCatchyTitle: Genera un título viral para la historia.
 */
export const generateCatchyTitle = async (story: string, language: Language): Promise<string> => {
  return executeSafeAI(async (ai) => {
    const response = await ai.models.generateContent({ 
      model: 'gemini-3-flash-preview', 
      contents: `ACT AS A VIRAL CONTENT STRATEGIST. Generate a highly impactful title for this story: "${story.substring(0, 500)}". Language: ${getLanguageName(language)}. Return ONLY the title text.` 
    });
    return response.text.trim();
  }, 'text');
};

/**
 * generateThumbnail: Genera una miniatura de alta calidad.
 */
export const generateThumbnail = async (story: string, stylePrompt: string, title: string, ratio: AspectRatio): Promise<{ url: string }> => {
  return executeSafeAI(async (ai) => {
    const promptGenResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        TASK: Create a professional image generation prompt for a viral video thumbnail.
        STORY CONTENT: "${story.substring(0, 1000)}"
        VIDEO TITLE: "${title}"
        STYLE CONTEXT: "${stylePrompt}"
        Return ONLY the English visual prompt.
      `.trim()
    });
    
    const visualThumbnailPrompt = promptGenResponse.text.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: visualThumbnailPrompt }] },
      config: { 
        imageConfig: { 
          aspectRatio: ratio
        } 
      }
    });
    
    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    if (!part?.inlineData) throw new Error("Error de miniatura");
    
    return { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
  }, 'image');
};

export const VISUAL_STYLES = [
  {
    category: 'Realismo de Vanguardia (Tendencia)',
    options: [
      { id: 'trend-0', label: 'Fotorrealismo Cinematográfico Pro', prompt: 'ULTRA-PHOTOREALISTIC CINEMATIC MASTERPIECE, 8k resolution, raw photography, living human beings with emotive eyes, authentic skin textures and pores, anamorphic lens flares, volumetric lighting, rich color palette, professional cinematography, extreme detail, natural movements, period-accurate clothing and environment.' },
      { id: 'trend-1', label: 'Fotografía Analógica Kodak Gold', prompt: 'Authentic 35mm film photography, Kodak Gold 200 aesthetic, warm natural tones, slight film grain, soft highlights, real human moments, living breathing people, vintage nostalgic look, 1990s realistic photography, sharp focus on eyes, emotive faces.' },
      { id: 'trend-2', label: 'Retrato Sony G-Master (Studio)', prompt: 'High-end professional studio portrait, Sony A7R IV, 85mm lens, f/1.8 bokeh, pin-sharp eyes, ultra-detailed skin textures, soft Rembrandt lighting, luxury magazine quality, living breathing human subject, authentic skin translucency.' },
      { id: 'trend-3', label: 'Acción GoPro POV Inmersivo', prompt: 'Hyper-realistic action cam POV, wide angle lens, 4k textures, natural outdoor lighting, immersive first-person perspective, authentic grit and textures, living people in motion, extreme realism.' },
      { id: 'trend-4', label: 'Cinematografía Nocturna / Cyber', prompt: 'Photorealistic night city cinematography, rain-slicked streets, subtle neon reflections on wet skin, cinematic anamorphic lens flares, high contrast, atmospheric realism, real urban life, living humans, moody lighting.' }
    ]
  },
  {
    category: 'Cinematográfico Documental',
    options: [
      { id: 'cine-1', label: 'National Geographic Heritage', prompt: 'ULTRA-REALISTIC DOCUMENTARY PHOTOGRAPHY, living breathing human beings, 8k resolution, raw photo, f/2.8, natural sun lighting, authentic skin textures and pores, emotive human expressions, professional cinematography, sharp focus, natural color grading, no artificial glow.' },
      { id: 'cine-2', label: 'Cine Épico Prime Lens', prompt: 'Historical cinematic film look with living actors, prime lenses, natural skin tones, sweat and authentic textures, soft shadows, epic composition, realistic period lighting, 35mm film grain, 4k master.' },
      { id: 'cine-3', label: 'Realismo de Calle Candid', prompt: 'Natural street photography of real people, candid style, sharp details, realistic city atmosphere, handheld camera look, authentic human interaction in environment, naturalistic colors.' }
    ]
  }
];

export const VOICE_OPTIONS = [
  { 
    name: 'Fenrir', 
    label: 'Mateo (Relato Íntimo)', 
    description: 'Voz masculina profunda, susurrante y emocional. Ideal para historias con una conexión personal muy fuerte.',
    style: 'Speak with an intimate, whispered, and close-miked male tone. Sound very human and emotional, as if telling a secret. Use natural breath sounds. Regionally neutral Spanish.' 
  },
  { 
    name: 'Charon', 
    label: 'Santiago (Gancho Potente)', 
    description: 'Voz masculina con autoridad y un inicio explosivo. Captura la atención desde el primer segundo.',
    style: 'Start with a high-impact, attention-grabbing male hook. Maintain a steady, authoritative documentary rhythm. Clear and commanding delivery. Regionally neutral Spanish.' 
  },
  { 
    name: 'Puck', 
    label: 'Javier (Energía Viral)', 
    description: 'Voz masculina rápida, entusiasta y moderna. Perfecta para contenido dinámico tipo TikTok/Reels.',
    style: 'Deliver with high energy and fast-paced male enthusiasm. Focus on varied pitch to keep the listener engaged every second. Sound like a modern content creator. Natural Spanish.' 
  },
  { 
    name: 'Kore', 
    label: 'Valentina (Elegancia Serena)', 
    description: 'Voz femenina equilibrada y sofisticada. Ideal para historias que requieren clase, serenidad y fluidez.',
    style: 'Speak with sophisticated female elegance and a balanced storytelling tone. Focus on perfect articulation and warm resonance. Calm yet engaging pacing. Regionally neutral.'
  },
  { 
    name: 'Zephyr', 
    label: 'Andrés (Emoción Humana)', 
    description: 'Voz masculina vulnerable y empática. Capaz de transmitir una amplia gama de sentimientos reales.',
    style: 'Speak with male empathy. Emotive opening hook.'
  }
];

/**
 * previewVoice: Genera una pequeña muestra de audio para preescucha.
 */
export const previewVoice = async (voiceName: string, language: Language): Promise<string> => {
  const previewText = language === 'es' 
    ? "Hola, soy una de las voces de StoryWeaver. ¿Cómo puedo ayudarte hoy?" 
    : "Hello, I am one of the voices of StoryWeaver. How can I help you today?";
  return generateNarration(previewText, language, voiceName);
};

/**
 * generateStoryFromTopic: Genera un guion completo a partir de un tema.
 */
export const generateStoryFromTopic = async (topic: string, targetDuration: number, language: Language, cta?: string, hook?: string): Promise<string> => {
  return executeSafeAI(async (ai) => {
    const prompt = `
      TOPIC: "${topic}". 
      DURATION: ${targetDuration}s. 
      Language: ${getLanguageName(language)}. 
      Return ONLY script text.
    `.trim();
    const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
    return response.text.trim();
  }, 'text');
};

/**
 * getTrendingSuggestions: Obtiene sugerencias de temas virales.
 */
export const getTrendingSuggestions = async (language: Language): Promise<string[]> => {
  return executeSafeAI(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `List 5 trending story topics in ${getLanguageName(language)}. Return JSON array of strings.`,
      config: { responseMimeType: 'application/json', responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }
    });
    
    const text = response.text;
    if (!text) return [];
    
    try {
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      return [];
    }
  }, 'text');
};

/**
 * createLiveSession: Inicia una sesión de asistente en vivo.
 */
export const createLiveSession = async (playbackCtx: AudioContext, onAudioChunk: (buf: AudioBuffer) => void, onClose: () => void, language: Language) => {
  const ai = getAIInstance();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
  const sessionPromise = ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks: {
      onopen: () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const scriptProc = inputCtx.createScriptProcessor(4096, 1, 1);
        scriptProc.onaudioprocess = (e) => {
          const blob = createPcmBlob(e.inputBuffer.getChannelData(0));
          sessionPromise.then(s => s.sendRealtimeInput({ media: blob }));
        };
        source.connect(scriptProc);
        scriptProc.connect(inputCtx.destination);
      },
      onmessage: async (msg) => {
        const data = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (data) onAudioChunk(await decodePcmData(decodeBase64(data), playbackCtx, 24000, 1));
      },
      onclose: onClose,
      onerror: (e) => console.error(e)
    },
    config: { 
      responseModalities: [Modality.AUDIO], 
      systemInstruction: `Eres un consultor experto. Ayuda al usuario con perfección gramatical y rigor histórico.` 
    }
  });
  return { disconnect: async () => { inputCtx.close(); stream.getTracks().forEach(t => t.stop()); sessionPromise.then(s => s.close()); } };
};
