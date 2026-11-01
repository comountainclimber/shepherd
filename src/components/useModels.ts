import { useEffect, useState } from "react";
import type { ModelCatalog } from "../model/models";
import { modelCatalog } from "../runner/live";

let known: ModelCatalog | null = null;

/** The models each agent can use, or null until the server says. */
export function useModels(): ModelCatalog | null {
  const [catalog, setCatalog] = useState(known);
  useEffect(() => {
    let live = true;
    void modelCatalog().then((next) => {
      known = next;
      if (live) setCatalog(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return catalog;
}
