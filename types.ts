
export enum AspectRatio {
  Landscape = '16:9',
  Portrait = '9:16',
  Square = '1:1',
}

export enum MediaType {
  Image = 'image',
  Video = 'video',
}

export enum VisualEffect {
  Static = 'static',
  ZoomIn = 'zoomIn',
  ZoomOut = 'zoomOut',
  PanLeft = 'panLeft',
  PanRight = 'panRight',
  TiltUp = 'tiltUp',
  TiltDown = 'tiltDown',
  DollyIn = 'dollyIn',
  DollyOut = 'dollyOut',
}

export enum TransitionEffect {
  None = 'none',
  Fade = 'fade',
  SlideLeft = 'slideLeft',
  SlideRight = 'slideRight',
  ZoomThrough = 'zoomThrough'
}

export enum SubtitleAnimation {
  None = 'none',
  Pop = 'pop',         
  Fade = 'fade',       
  Bounce = 'bounce',
  Typewriter = 'typewriter', 
  Glow = 'glow',
}

export type Language = 'es' | 'en';

export interface Scene {
  id: string;
  script: string;
  visualPrompt: string;
  mediaType: MediaType;
  mediaUrl?: string; 
  mediaMimeType?: string;
  duration: number; 
  isGenerating: boolean;
  visualEffect?: VisualEffect; 
  isCta?: boolean; 
  error?: string; 
}

export interface StoryMetadata {
  genre: string;
  tone: string;
  recommendedVoice: string; 
  consistentStyle: string; 
}

export interface StoryState {
  title: string;
  rawStory: string;
  scenes: Scene[];
  audioUrl?: string;
  totalDuration: number;
  targetDuration: number; 
  aspectRatio: AspectRatio;
  watermarkUrl?: string; 
  outroUrl?: string; 
  outroType?: 'image' | 'video'; 
  visualStyle?: string; 
  metadata?: StoryMetadata; 
}

export interface SubtitleStyle {
  visible: boolean; 
  fontFamily: string;
  fontSize: number; 
  textColor: string;
  activeTextColor: string; 
  outlineColor: string;
  strokeWidth: number; 
  backgroundColor: string; 
  backgroundOpacity: number; 
  verticalPosition: number; 
  showFutureText: boolean; 
  animation: SubtitleAnimation; 
}

export enum AppStep {
  Drafting = 'Drafting',
  Visuals = 'Visuals',
  Preview = 'Preview',
}
