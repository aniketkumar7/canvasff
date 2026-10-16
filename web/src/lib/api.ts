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

export async function getJob(id: string): Promise<Job> {
  const r = await fetch(`${API}/jobs/${id}`);
  const body = await r.json().catch(() => ({}));
  if (r.status === 404) throw new JobGone(body.detail ?? "Job not found");
  if (!r.ok) throw new Error(body.detail ?? `API error ${r.status}`);
  return body as Job;
}
