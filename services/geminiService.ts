
import { GoogleGenAI } from "@google/genai";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeQuery = (query: string): string => {
    // SECURITY: Limit length and remove control characters
    if (query.length > 200) {
        query = query.substring(0, 200);
    }
    // Remove non-printable ASCII characters (except basic punctuation) to prevent weird injection attempts
    // Allow alphanumerics, spaces, and basic punctuation: ,.-
    return query.replace(/[^\w\s,.-]/gi, '');
};

export const resolveLocationWithGemini = async (query: string): Promise<{ lat: number; lng: number } | null> => {
  const apiKey = process.env.API_KEY || '';
  // If no API key, we can't make the call. Return null or throw specific error.
  if (!apiKey) {
      console.warn("No API Key found for Gemini Service.");
      return null;
  }

  const sanitizedQuery = sanitizeQuery(query);
  if (!sanitizedQuery.trim()) {
      throw new Error("Invalid query format.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-2.5-flash';

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      // We use the googleMaps tool for grounding
      const response = await ai.models.generateContent({
        model,
        contents: `Find the precise geographic coordinates (latitude and longitude) for: "${sanitizedQuery}".`,
        config: {
          tools: [{ googleMaps: {} }],
        },
      });

      const candidates = response.candidates;
      if (!candidates || candidates.length === 0) return null;

      // Extract text and parse coordinates
      const text = response.text;
      if (text) {
          // Look for lat/lng patterns in the text response
          // e.g. "Latitude: 40.7128, Longitude: -74.0060" or "40.7128, -74.0060"
          const latLngRegex = /(-?\d+\.\d{3,})[,\s]+(-?\d+\.\d{3,})/;
          const match = text.match(latLngRegex);
          if (match) {
              return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
          }
      }

      // If successful but no coordinates found in text
      return null;

    } catch (error: any) {
      const msg = error.message || '';
      const status = error.status;

      // 429: Too Many Requests (Rate Limiting)
      // 503: Service Unavailable (Temporary Overload)
      if (status === 429 || status === 503 || msg.includes('429') || msg.includes('quota') || msg.includes('overloaded')) {
        attempts++;
        if (attempts >= maxAttempts) {
            throw new Error("System is currently busy (Rate Limit Reached). Please wait a moment and try again.");
        }
        // Exponential backoff: 1s, 2s, 4s...
        const backoff = 1000 * Math.pow(2, attempts - 1);
        console.warn(`Gemini API busy, retrying in ${backoff}ms...`);
        await delay(backoff);
        continue;
      }
      
      // 403: Forbidden / Quota Exceeded / Billing
      if (status === 403 || msg.includes('403') || msg.includes('permission')) {
          throw new Error("API Quota Exceeded or Permission Denied. Please check your billing/API key.");
      }

      // Other errors (400 Bad Request, etc.)
      console.error("Gemini Grounding Error:", error);
      // For general errors, we don't retry.
      throw new Error("Unable to resolve location due to an API error.");
    }
  }
  return null;
};
