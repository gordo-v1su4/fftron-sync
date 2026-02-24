export interface EssentiaRhythmResponse {
  bpm: number;
  beats: number[];
  confidence: number;
  onsets: number[];
  duration: number;
  energy: {
    mean: number;
    std: number;
    curve: number[];
  };
}

export interface EssentiaStructureSection {
  start: number;
  end: number;
  label: string;
  duration: number;
  energy: number;
}

export interface EssentiaStructureResponse {
  sections: EssentiaStructureSection[];
  boundaries: number[];
}

const getBaseUrl = (): string => (import.meta.env.VITE_ESSENTIA_API_BASE_URL ?? 'https://essentia.v1su4.dev').replace(/\/+$/, '');

const postAudioForm = async <T>(path: string, file: File, apiKey: string): Promise<T> => {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey
    },
    body: form
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Essentia ${path} failed (${response.status}): ${detail || response.statusText}`);
  }

  return response.json() as Promise<T>;
};

export const analyzeEssentiaRhythm = (file: File, apiKey: string): Promise<EssentiaRhythmResponse> =>
  postAudioForm<EssentiaRhythmResponse>('/analyze/rhythm', file, apiKey);

export const analyzeEssentiaStructure = (file: File, apiKey: string): Promise<EssentiaStructureResponse> =>
  postAudioForm<EssentiaStructureResponse>('/analyze/structure', file, apiKey);
