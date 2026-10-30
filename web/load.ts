import { useEffect, useState } from "react";
import { api } from "./lib";

// Fetches on mount; `reload` refetches after a change on the page.
export function useLoad<T>(path: string): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    api<T>(path)
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    setData(null);
    reload();
  }, [path]);
  return { data, error, reload };
}
