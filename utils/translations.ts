
import { Language } from '../types';

export const translations: Record<Language, any> = {
  es: {
    langName: "Español",
    header: {
        stepDrafting: "Borrador",
        stepVisuals: "Visuales",
        stepPreview: "Vista Previa",
        apiKey: "Clave API"
    },
    live: {
        title: "Lluvia de ideas con Gemini Live",
        desc: "Habla para refinar tu historia en tiempo real.",
        connect: "Conectando...",
        end: "Terminar Sesión",
        start: "Iniciar Chat de Voz",
        error: "Error de conexión"
    },
    editor: {
        title: "1. Redacta tu Historia",
        desc: "Escribe un tema simple y deja que la IA cree el guion, o escribe tu propia historia.",
        scriptLabel: "Tema o Guion de la Historia",
        placeholder: "Escribe un tema (ej. 'Un viaje épico a Marte') o pega tu guion completo...",
        btnMagic: "✨ Crear Guion desde Tema",
        magicProcessing: "Escribiendo historia...",
        duration: "Duración",
        ratio: "Formato",
        styleLabel: "Estilo Visual",
        stylePlaceholder: "Selecciona un estilo...",
        hookLabel: "Incluir Gancho (Intro)",
        hookPlaceholder: "Ej: ¿Sabías que...?",
        ctaLabel: "Incluir Llamada a la Acción",
        ctaPlaceholder: "Ej: ¡Suscríbete para ver más!",
        brandingTitle: "Marca y Final (Opcional)",
        uploadLogo: "Logo / Marca de Agua",
        uploadOutro: "Final (Outro)",
        outroTypeImage: "Imagen (3s)",
        outroTypeVideo: "Video (3-6s)",
        btnGenerate: "Crear Desglose de Escenas",
        btnProcessing: "Pensando y Desglosando...",
        landscape: "16:9 Horizontal",
        portrait: "9:16 Vertical",
        square: "1:1 Cuadrado",
        remove: "Quitar",
        autoAdvance: "Auto-Avanzar a Vista Previa",
        autoDownload: "Auto-Descargar Video Final"
    },
    visuals: {
        title: "2. Crear Visuales",
        btnProceed: "Ir a Vista Previa",
        btnResume: "Reanudar Generación",
        btnStop: "Detener Generación",
        btnCancel: "Cancelar",
        scene: "Escena",
        script: "GUION NARRATIVO",
        prompt: "PROMPT VISUAL",
        effectLabel: "Efecto Visual",
        effects: {
            static: "Estático",
            zoomIn: "Zoom Acercar",
            zoomOut: "Zoom Alejar",
            panLeft: "Desplazar Izq",
            panRight: "Desplazar Der",
            tiltUp: "Inclinación Arriba",
            tiltDown: "Inclinación Abajo",
            dollyIn: "Dolly In (Rápido)",
            dollyOut: "Dolly Out (Rápido)"
        },
        btnImgStd: "Generar Imagen (Gratis)",
        btnUpload: "Subir Imagen",
        statusEmpty: "Sin Visuales"
    },
    preview: {
        back: "Volver a Visuales",
        title: "Vista Previa Final",
        loading: "Sincronizando audio...",
        voiceLabel: "Voz Narrador",
        volLabel: "Volumen Narración",
        subsTitle: "Subtítulos",
        subsFont: "Tipografía",
        subsAnim: "Animación",
        animPop: "Pop Viral",
        animBounce: "Rebote",
        animFade: "Desvanecer",
        animType: "Máquina",
        animGlow: "Resplandor"
    },
    footer: "Impulsado por Gemini 2.5 Live, Gemini 2.5 Flash y Veo"
  },
  en: {
    langName: "English",
    header: {
        stepDrafting: "Drafting",
        stepVisuals: "Visuals",
        stepPreview: "Preview",
        apiKey: "API Key"
    },
    live: {
        title: "Brainstorm with Gemini Live",
        desc: "Speak to refine your story ideas in real-time.",
        connect: "Connecting...",
        end: "End Session",
        start: "Start Voice Chat",
        error: "Connection Error"
    },
    editor: {
        title: "1. Draft Your Story",
        desc: "Write a simple topic and let AI create the script.",
        scriptLabel: "Story Topic or Script",
        placeholder: "Enter a topic...",
        btnMagic: "✨ Create Script from Topic",
        magicProcessing: "Writing...",
        duration: "Duration",
        ratio: "Format",
        styleLabel: "Visual Style",
        stylePlaceholder: "Select a style...",
        hookLabel: "Include Hook",
        hookPlaceholder: "Did you know...?",
        ctaLabel: "Include CTA",
        ctaPlaceholder: "Subscribe for more!",
        brandingTitle: "Branding",
        uploadLogo: "Logo",
        uploadOutro: "Outro",
        outroTypeImage: "Image (3s)",
        outroTypeVideo: "Video (3-6s)",
        btnGenerate: "Generate Breakdown",
        btnProcessing: "Processing...",
        landscape: "16:9 Landscape",
        portrait: "9:16 Portrait",
        square: "1:1 Square",
        remove: "Remove",
        autoAdvance: "Auto-Advance",
        autoDownload: "Auto-Download"
    },
    visuals: {
        title: "2. Create Visuals",
        btnProceed: "Go to Preview",
        btnResume: "Resume",
        btnStop: "Stop",
        btnCancel: "Cancel",
        scene: "Scene",
        script: "SCRIPT",
        prompt: "PROMPT",
        effectLabel: "Visual Effect",
        effects: {
            static: "Static",
            zoomIn: "Zoom In",
            zoomOut: "Zoom Out",
            panLeft: "Pan Left",
            panRight: "Pan Right",
            tiltUp: "Tilt Up",
            tiltDown: "Tilt Down",
            dollyIn: "Dolly In",
            dollyOut: "Dolly Out"
        },
        btnImgStd: "Generate Image",
        btnUpload: "Upload",
        statusEmpty: "No Media"
    },
    preview: {
        back: "Back",
        title: "Final Preview",
        loading: "Syncing audio...",
        voiceLabel: "Narrator Voice",
        volLabel: "Narration Volume",
        subsTitle: "Subtitles",
        subsFont: "Typography",
        subsAnim: "Animation",
        animPop: "Viral Pop",
        animBounce: "Bounce",
        animFade: "Fade",
        animType: "Typewriter",
        animGlow: "Glow"
    },
    footer: "Powered by Gemini 2.5 Live, Gemini 2.5 Flash and Veo"
  }
};

export const getLanguageName = (lang: Language): string => {
  return translations[lang].langName;
};
