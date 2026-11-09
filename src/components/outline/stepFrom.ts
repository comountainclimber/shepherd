import { blankTask, newStep } from "../../model/factory";
import type { Task } from "../../model/types";
import { useShepherd } from "../../store";

const NAME_LIMIT = 80;

/** A line too long for a name keeps the whole line as the step's prompt. */
export function stepFrom(
  goalId: string,
  line: string,
  prompt: string,
  agentId: string | null,
  context = "",
  details: Partial<Pick<Task, "runner" | "acceptance" | "checkCommand">> = {},
): Task {
  let name = line;
  if (line.length > NAME_LIMIT) {
    const cut = line.slice(0, NAME_LIMIT);
    name = `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : NAME_LIMIT)}…`;
  }
  const task = newStep(useShepherd.getState().state.goals.find((goal) => goal.id === goalId)!.projectId, name, prompt || (name === line ? "" : line), agentId, goalId);
  return blankTask({
    ...task,
    description: context,
    runner: details.runner,
    acceptance: details.acceptance,
    checkCommand: details.runner === "human" ? undefined : details.checkCommand,
  });
}

