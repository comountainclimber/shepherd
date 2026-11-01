import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hasCycle, isTaskDimmed, taskMatches, tasksForGoal, waitingOn } from "../../model/selectors";
import { dependencySatisfied } from "../../model/verify";
import { AGENTS } from "../../model/workspace";
import { initialFilters, useShepherd } from "../../store";
import { markComplete, runLabel, runTask, stopTask } from "../../runner/live";
import { placeFor } from "../saved/addSaved";
import { Sheep } from "../shell/Hud";
import { Button, GateSelect } from "../ui";
import { NODE_HEIGHT, NODE_WIDTH, TaskNodeView, type TaskFlowNode } from "./TaskNode";

const nodeTypes = { task: TaskNodeView };

export function OrchestrationCanvas() {
  return (
    <div className="h-full w-full bg-bg">
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
    </div>
  );
}

function CanvasInner() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const state = useShepherd((store) => store.state);
  const ui = useShepherd((store) => store.ui);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const selectEdge = useShepherd((store) => store.selectEdge);
  const setContextMenu = useShepherd((store) => store.setContextMenu);
  const setFilters = useShepherd((store) => store.setFilters);
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});

  const projectTasks = useMemo(
    () => tasksForGoal(state, ui.goalId),
    [state.tasks, ui.goalId],
  );
  const visibleCount = projectTasks.filter((task) => taskMatches(task, ui.filters, state.tasks, state.dependencies)).length;
  const layoutKey = projectTasks
    .map((task) => {
      const position = dragging[task.id] ?? task.position;
      const dimmed = isTaskDimmed(task, ui.filters, state.tasks, state.dependencies, ui.selectedTaskId);
      return `${task.id}:${position.x}:${position.y}:${dimmed ? 1 : 0}:${task.id === ui.selectedTaskId ? 1 : 0}`;
    })
    .join("|");

  const nodes: TaskFlowNode[] = useMemo(
    () =>
      projectTasks.map((task) => ({
        id: task.id,
        type: "task" as const,
        position: dragging[task.id] ?? task.position,
        selected: task.id === ui.selectedTaskId,
        initialWidth: NODE_WIDTH,
        initialHeight: NODE_HEIGHT,
        data: {
          taskId: task.id,
          dimmed: isTaskDimmed(task, ui.filters, state.tasks, state.dependencies, ui.selectedTaskId),
        },
        zIndex: task.id === ui.selectedTaskId ? 10 : 0,
      })),
    [layoutKey],
  );

  const edges: Edge[] = useMemo(() => {
    const ids = new Set(projectTasks.map((task) => task.id));
    return state.dependencies
      .filter((dep) => ids.has(dep.source) && ids.has(dep.target))
      .map((dep) => {
        const source = state.tasks.find((task) => task.id === dep.source);
        const target = state.tasks.find((task) => task.id === dep.target);
        const sourceDim = source ? isTaskDimmed(source, ui.filters, state.tasks, state.dependencies, ui.selectedTaskId) : false;
        const targetDim = target ? isTaskDimmed(target, ui.filters, state.tasks, state.dependencies, ui.selectedTaskId) : false;
        const dim = sourceDim || targetDim;
        const selected = dep.id === ui.selectedEdgeId;
        const open = dependencySatisfied(dep, source);
        const flowing = source?.status === "running" || (open && target?.status === "running");
        const stroke = selected ? "#f2b544" : dim ? "rgba(255,255,255,0.07)" : open ? "rgba(76,199,127,0.85)" : "rgba(255,255,255,0.28)";
        return {
          id: dep.id,
          source: dep.source,
          target: dep.target,
          type: "default",
          animated: flowing,
          selected,
          style: {
            stroke,
            strokeWidth: selected ? 3 : 2,
            strokeDasharray: open || flowing ? undefined : "4 6",
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
        };
      });
  }, [projectTasks, state.dependencies, state.tasks, ui.filters, ui.goalId, ui.selectedTaskId, ui.selectedEdgeId]);

  const selectedEdge = useMemo(() => {
    const dep = state.dependencies.find((item) => item.id === ui.selectedEdgeId);
    if (!dep) return null;
    const source = state.tasks.find((task) => task.id === dep.source);
    const target = state.tasks.find((task) => task.id === dep.target);
    return {
      dep,
      source: source?.name ?? dep.source,
      target: target?.name ?? dep.target,
      open: dependencySatisfied(dep, source),
    };
  }, [state.dependencies, state.tasks, ui.selectedEdgeId]);

  const onNodesChange = useCallback((_changes: NodeChange[]) => {
    // Positions are controlled. Drag updates come from onNodeDrag so measurement
    // changes cannot feed back into React state.
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const next = [...state.dependencies, { source: connection.source, target: connection.target }];
      if (hasCycle(next)) return;
      dispatch({ type: "connect", source: connection.source, target: connection.target, gate: "verified" });
    },
    [dispatch, state.dependencies],
  );

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;
  const shape = state.goals
    .find((project) => project.id === ui.goalId)
    ?.outline?.map((item) => `${item.id}:${item.depth}`)
    .join("|");

  useEffect(() => {
    const id = window.setTimeout(() => fitViewRef.current({ padding: 0.2, duration: 200 }), 80);
    return () => window.clearTimeout(id);
  }, [ui.goalId, ui.fitToken, shape]);

  useEffect(() => {
    const search = ui.filters.search.trim();
    if (!search) return;
    const matches = nodesRef.current.filter((node) => !node.data.dimmed);
    if (matches.length) fitViewRef.current({ nodes: matches, duration: 180, padding: 0.22 });
  }, [ui.filters.search]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (!ui.selectedEdgeId) return;
      event.preventDefault();
      dispatch({ type: "disconnect", id: ui.selectedEdgeId });
      selectEdge(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, selectEdge, ui.selectedEdgeId]);

  useEffect(() => {
    // Cmd/Ctrl with + - 0 zoom the map instead of the whole page.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const { key, code } = event;
      if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") void zoomIn({ duration: 150 });
      else if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") void zoomOut({ duration: 150 });
      else if (key === "0" || code === "Digit0" || code === "Numpad0") void fitView({ padding: 0.2, duration: 200 });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, fitView]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDrag={(_, node) => setDragging((current) => ({ ...current, [node.id]: node.position }))}
        onNodeDragStop={(_, node) => {
          setDragging((current) => {
            if (!current[node.id]) return current;
            const next = { ...current };
            delete next[node.id];
            return next;
          });
          dispatch({ type: "moveTask", id: node.id, position: node.position });
        }}
        onConnect={onConnect}
        onNodeClick={(_, node) => selectTask(node.id)}
        onEdgeClick={(_, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectTask(null);
          selectEdge(null);
          setContextMenu(null);
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          selectTask(node.id);
          setContextMenu({ x: event.clientX, y: event.clientY, taskId: node.id });
        }}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.35}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        connectionLineType={ConnectionLineType.Bezier}
        nodesConnectable
        nodesDraggable
        elementsSelectable
        panOnScroll
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(255,255,255,0.07)" />
        <Controls showInteractive={false} position="bottom-right" />
        {selectedEdge ? (
          <Panel position="top-center">
            <div className="enter flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-muted shadow-xl">
              <span className="max-w-48 truncate font-medium text-text">{selectedEdge.target}</span>
              <span>opens</span>
              <GateSelect
                value={selectedEdge.dep.gate}
                onChange={(gate) =>
                  dispatch({ type: "connect", source: selectedEdge.dep.source, target: selectedEdge.dep.target, gate })
                }
              />
              <span>of</span>
              <span className="max-w-48 truncate font-medium text-text">{selectedEdge.source}</span>
              <span className={selectedEdge.open ? "font-medium text-completed" : "font-medium text-queued"}>
                {selectedEdge.open ? "Open" : "Closed"}
              </span>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  dispatch({ type: "disconnect", id: selectedEdge.dep.id });
                  selectEdge(null);
                }}
              >
                Remove
              </Button>
            </div>
          </Panel>
        ) : null}
      </ReactFlow>
      {ui.contextMenu ? <TaskMenu /> : null}
      {projectTasks.length === 0 ? (
        <Overlay>
          <div className="flex justify-center">
            <Sheep size={48} />
          </div>
          <div className="mt-3 text-[16px] font-semibold text-text">The map of your steps shows up here</div>
          <p className="mx-auto mt-1 max-w-xs text-[14px] leading-5 text-muted">
            Write the steps on the left, or describe what you want done and let Codex draft them.
          </p>
        </Overlay>
      ) : null}
      {projectTasks.length > 0 && visibleCount === 0 ? (
        <Overlay>
          <div className="text-[16px] font-semibold text-text">Nothing to show here right now.</div>
          <Button className="mt-3" variant="ghost" onClick={() => setFilters(initialFilters)}>
            Show every task
          </Button>
        </Overlay>
      ) : null}
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="enter pointer-events-auto rounded-xl border border-line-strong bg-surface px-8 py-6 text-center shadow-xl">{children}</div>
    </div>
  );
}

function TaskMenu() {
  const menu = useShepherd((store) => store.ui.contextMenu);
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === menu?.taskId));
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const dispatch = useShepherd((store) => store.dispatch);
  const setContextMenu = useShepherd((store) => store.setContextMenu);
  const selectTask = useShepherd((store) => store.selectTask);
  const setSaveFor = useShepherd((store) => store.setSaveFor);
  const setAddSaved = useShepherd((store) => store.setAddSaved);
  const [reassigning, setReassigning] = useState(false);
  if (!menu || !task) return null;

  const close = () => setContextMenu(null);
  const left = Math.min(menu.x, window.innerWidth - 230);
  const top = Math.min(menu.y, window.innerHeight - 320);
  const waiting = task.status === "running" ? null : waitingOn(task, tasks, deps);

  return (
    <div
      className="enter fixed z-30 w-56 overflow-hidden rounded-lg border border-line-strong bg-surface p-1 text-[13px] shadow-xl"
      style={{ left, top }}
    >
      {waiting ? <div className="px-3 py-1.5 text-[12px] leading-4 text-queued">{waiting}</div> : null}
      {task.runner === "human" ? (
        waiting || task.status === "completed" ? null : <MenuItem label="Mark complete" onClick={() => { void markComplete(task.id); close(); }} />
      ) : (
        <>
          {task.status === "running" ? (
            <MenuItem label="Pause" onClick={() => { void stopTask(task.id, "blocked"); close(); }} />
          ) : waiting ? null : (
            <MenuItem label={runLabel(task)} onClick={() => { void runTask(task.id); close(); }} />
          )}
          {task.status !== "queued" ? (
            <MenuItem label="Cancel" onClick={() => { void stopTask(task.id, "queued"); close(); }} />
          ) : null}
        </>
      )}
      {task.runner === "agent" ? <MenuItem label="Reassign" onClick={() => setReassigning((value) => !value)} /> : null}
      {reassigning ? (
        <div className="max-h-36 overflow-auto rounded-md bg-black/20 py-1">
          {AGENTS.map((agent) => (
            <MenuItem
              key={agent.id}
              label={agent.name}
              onClick={() => {
                dispatch({ type: "reassign", id: task.id, agentId: agent.id });
                close();
              }}
            />
          ))}
          <MenuItem
            label="Unassigned"
            onClick={() => {
              dispatch({ type: "reassign", id: task.id, agentId: null });
              close();
            }}
          />
        </div>
      ) : null}
      <MenuItem label="Add a saved step after this…" onClick={() => setAddSaved(placeFor(task.goalId, task.id))} />
      {task.name.trim() ? <MenuItem label="Save for reuse…" onClick={() => setSaveFor(task.id)} /> : null}
      <MenuItem
        label="Delete"
        danger
        onClick={() => {
          dispatch({ type: "deleteTask", id: task.id });
          selectTask(null);
          close();
        }}
      />
    </div>
  );
}

function MenuItem({
  label,
  hint,
  danger = false,
  onClick,
}: {
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2 ${danger ? "text-failed" : "text-text"}`}
    >
      <span>{label}</span>
      {hint ? <span className="font-mono text-[10px] text-faint">{hint}</span> : null}
    </button>
  );
}
