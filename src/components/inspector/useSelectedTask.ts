import { useShepherd } from "../../store";

export function useSelectedTask() {
  const taskId = useShepherd((store) => store.ui.selectedTaskId);
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === taskId));
  if (!task) throw new Error("inspector without a task");
  return task;
}
