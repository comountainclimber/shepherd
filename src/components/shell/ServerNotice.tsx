import { TriangleAlert, Unplug, X } from "lucide-react";
import { useShepherd } from "../../store";

/** Says so when the board may be stale, or when the server refused something you did. */
export function ServerNotice() {
  const connection = useShepherd((store) => store.connection);
  const loaded = useShepherd((store) => store.loaded);
  const problem = useShepherd((store) => store.problem);
  const setProblem = useShepherd((store) => store.setProblem);
  if (connection === "lost") {
    return (
      <div className="flex items-center gap-2 border-b-2 border-failed/40 bg-failed/15 px-4 py-2 text-[13px] font-semibold text-failed">
        <Unplug size={16} />
        {loaded ? "Lost the connection to Shepherd's server. What you see may be out of date. Reconnecting…" : "Can't reach Shepherd's server. Is it running?"}
      </div>
    );
  }
  if (!problem) return null;
  return (
    <div className="flex items-center gap-2 border-b-2 border-approval/40 bg-approval/10 px-4 py-2 text-[13px] text-approval">
      <TriangleAlert size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">{problem}</span>
      <button type="button" aria-label="Dismiss" className="rounded-lg p-1 hover:bg-white/10" onClick={() => setProblem(null)}>
        <X size={14} />
      </button>
    </div>
  );
}
