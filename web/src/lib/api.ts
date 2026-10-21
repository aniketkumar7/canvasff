/** Render API. Override per environment with VITE_API_URL. */
export const API = (import.meta.env.VITE_API_URL ?? "https://canvasff-api.onrender.com").replace(/\/$/, "");

export type JobStatus = "uploading" | "queued" | "rendering" | "done" | "error";

export type UploadText = { title?: string; description?: string; tags?: string; pin?: string };

export type Job = {
  id: string;
  name: string;
  status: JobStatus;
  created: number;
  updated: number;
  error?: string;
  log?: string;
  upload?: UploadText;
};

export class JobGone extends Error {}

export const videoUrl = (id: string) => `${API}/jobs/${id}/video.mp4`;

/** POST /jobs with upload progress (fetch can't report upload progress, XHR can). */
export function createJob(form: FormData, onProgress: (ratio: number) => void): Promise<Job> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/jobs`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: (Job & { detail?: unknown }) | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status < 300 && body) return resolve(body);
      const detail = body?.detail;
      reject(new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () =>
      reject(new Error(`Can't reach the API at ${API}. It may be waking up, so try again in a minute.`));
    xhr.send(form);
  });
}

/** A NoCopyrightSounds track (free for Shorts with its credit in the description). */
export type NcsTrack = { id: string; title: string; artist: string; genre: string; cover: string; url: string };
/** Genre id from GET /music/genres (phonk, trap, dnb, ...). */
export type NcsGenre = string;
export type NcsGenreOption = { id: NcsGenre; label: string };

async function json<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail ?? `API error ${r.status}`);
  return body as T;
}

/** One page (10 tracks) of a genre or search; `more` = another page exists. */
export type NcsPage = { items: NcsTrack[]; more: boolean };
export const getMusic = (genre: NcsGenre, page = 0) => json<NcsPage>(`/music?genre=${encodeURIComponent(genre)}&page=${page}`);
export const searchMusic = (q: string, page = 0) => json<NcsPage>(`/music?q=${encodeURIComponent(q)}&page=${page}`);
export const getGenres = () => json<NcsGenreOption[]>("/music/genres");

/** A free photo from a search (Unsplash, Pexels, Pixabay, Wikimedia). The server downloads it by (source, id). */
export type Photo = {
  source: string;
  id: string;
  thumb: string;
  full: string;
  width: number;
  height: number;
  author: string;
  license: string;
  credit: string;
  page: string;
};
export type PhotoPage = { items: Photo[]; more: boolean };
export type PhotoSource = { id: string; label: string };
export const getPhotoSources = () => json<PhotoSource[]>("/photos/sources");
export const searchPhotos = (source: string, q: string, page = 0) =>
  json<PhotoPage>(`/photos?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}&page=${page}`);
export const getCredit = (id: string) => json<{ credit: string }>(`/music/${encodeURIComponent(id)}/credit`).then((r) => r.credit);

export async function getJob(id: string): Promise<Job> {
  const r = await fetch(`${API}/jobs/${id}`);
  const body = await r.json().catch(() => ({}));
  if (r.status === 404) throw new JobGone(body.detail ?? "Job not found");
  if (!r.ok) throw new Error(body.detail ?? `API error ${r.status}`);
  return body as Job;
}
