
/**
 * Utilidad de Cache para persistir respuestas de la IA y evitar el agotamiento de cuota (429).
 */
export const aiCache = {
  get: <T>(key: string): T | null => {
    try {
      const item = localStorage.getItem(`sw_cache_${key}`);
      if (!item) return null;
      const { value, expiry } = JSON.parse(item);
      if (expiry && Date.now() > expiry) {
        localStorage.removeItem(`sw_cache_${key}`);
        return null;
      }
      return value as T;
    } catch (e) {
      return null;
    }
  },

  set: <T>(key: string, value: T, ttl: number = 3600000): void => { // Default 1 hour
    try {
      // Si el valor es una cadena base64 muy larga (audio/imagen), 
      // preferimos no guardarla en localStorage para no agotar los 5MB
      if (typeof value === 'string' && value.length > 500000) {
        return; 
      }
      
      const data = {
        value,
        expiry: ttl ? Date.now() + ttl : null
      };
      localStorage.setItem(`sw_cache_${key}`, JSON.stringify(data));
    } catch (e: any) {
      // Si el localStorage está lleno, limpiar entradas viejas
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        localStorage.clear();
      }
    }
  },

  generateKey: (prefix: string, content: string): string => {
    // Simple hash para el contenido
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; 
    }
    return `${prefix}_${hash}`;
  }
};
