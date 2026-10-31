import { useCallback } from "react";
import type { NextStep } from "../model/stage";
import type { Task } from "../model/types";
import { markComplete, mergeTask, runTask } from "../runner/live";
import { useShepherd } from "../store";

/** Carries out a task's next step. Reviewing opens its checks, since accepting without looking is not a review. */
export function useNextStep() {
  const openTask = useShepherd((store) => store.openTask);
  return useCallback(
    (task: Task, step: Exclude<NextStep, null>) => {
      if (step === "review") openTask(task.id, "checks");
      else if (step === "done") void markComplete(task.id);
      else if (step === "merge") void mergeTask(task.id);
      else void runTask(task.id);
    },
    [openTask],
  );
}
