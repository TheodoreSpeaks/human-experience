import { useEffect, useState } from "react";

export type Valence = "good" | "fine" | "bad";
export type UserCard = { id: string; name: string; image: string | null };
export type Entry = { experienceId: string; title: string; note: string; entryId: string };
// previous is set when this is a repeat of something already ranked.
// titleEditable: only while nobody else has the experience and it hasn't been rated (titles are shared).
export type Pending = Entry & { previous: { score: number; valence: Valence } | null; titleEditable: boolean };
export type Ranked = { experienceId: string; title: string };
export type SpectrumRow = Entry & { valence: Valence; times: number; score: number };

// Anyone shown anywhere, with how your tastes line up (match is null below 3 shared experiences).
export type Person = UserCard & {
  handle: string;
  match: number | null;
  shared: number;
  ranked: number;
  isFollowing: boolean;
  isYou: boolean;
};

// An experience in everyone's spectrum. score is null until a real account has rated it.
export type GlobalRow = {
  experienceId: string;
  title: string;
  score: number | null;
  raters: number;
  mine: { score: number; valence: Valence } | null;
};

// Global scores aren't tied to one person's bucket, so color them by the band they fall in.
export function valenceOf(score: number): Valence {
  return score >= 6.7 ? "good" : score >= 3.4 ? "fine" : "bad";
}

export const peopleCount = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${path} failed with ${res.status}`);
  return body as T;
}

export const sendJson = <T = unknown>(method: "POST" | "PATCH" | "DELETE", path: string, data?: unknown) =>
  api<T>(path, {
    method,
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

export const renameExperience = (experienceId: string, title: string) =>
  sendJson("PATCH", `/api/experiences/${experienceId}`, { title });
export const editNote = (entryId: string, note: string) => sendJson("PATCH", `/api/entries/${entryId}`, { note });

// A tiny pushState router: no library needed for three pages.
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo(0, 0);
}

export function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
