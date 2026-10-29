import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hasCycle, isTaskDimmed, taskMatches, tasksForProject, waitingOn } from "../../model/selectors";
import { GATE_LABEL, STATUSES, STATUS_LABEL, type TaskStatus } from "../../model/types";
import { dependencySatisfied } from "../../model/verify";
import { AGENTS } from "../../model/workspace";
import { initialFilters, useShepherd } from "../../store";
import { markComplete, runLabel, runTask, stopTask } from "../../runner/live";
import { Button, GateSelect, statusBg } from "../ui";
import { TaskNodeView, type TaskFlowNode } from "./TaskNode";

const nodeTypes = { task: TaskNodeView };

const statusHex: Record<TaskStatus, string> = {
  queued: "#8b909a",
  running: "#d4a054",
  completed: "#8eae88",
  blocked: "#d09255",
  failed: "#d17b6a",
};

export function OrchestrationCanvas() {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
    </div>
  );
}

function CanvasInner() {
  const { fitView } = useReactFlow();
  const state = useShepherd((store) => store.state);
  const ui = useShepherd((store) => store.ui);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const selectEdge = useShepherd((store) => store.selectEdge);
  const setContextMenu = useShepherd((store) => store.setContextMenu);
  const setFilters = useShepherd((store) => store.setFilters);
  const setNewTaskOpen = useShepherd((store) => store.setNewTaskOpen);
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});

  const projectTasks = useMemo(
    () => tasksForProject(state, ui.projectId),
    [state.tasks, ui.projectId],
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
        initialWidth: 248,
        initialHeight: 112,
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
        const live = source?.status === "running" && (target?.status === "queued" || target?.status === "blocked");
        const stroke = selected ? "#c4a574" : dim ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.32)";
        return {
          id: dep.id,
          source: dep.source,
          target: dep.target,
          type: "smoothstep",
          animated: live,
          selected,
          label: GATE_LABEL[dep.gate],
          labelStyle: { fill: dep.gate === "verified" ? "#c4a574" : "#908d86", fontSize: 10 },
          labelBgStyle: { fill: "#0e0f12" },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 2,
          style: { stroke, strokeWidth: selected ? 1.6 : 1 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
        };
      });
  }, [projectTasks, state.dependencies, state.tasks, ui.filters, ui.projectId, ui.selectedTaskId, ui.selectedEdgeId]);

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

  useEffect(() => {
    const id = window.setTimeout(() => fitViewRef.current({ padding: 0.2, duration: 200 }), 80);
    return () => window.clearTimeout(id);
  }, [ui.projectId, ui.fitToken]);

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
        connectionLineType={ConnectionLineType.SmoothStep}
        nodesConnectable
        nodesDraggable
        elementsSelectable
        panOnScroll
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.16)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          bgColor="#14161b"
          maskColor="rgba(8,9,12,0.72)"
          nodeColor={(node) => {
            const task = state.tasks.find((item) => item.id === node.id);
            return task ? statusHex[task.status] : "#8b909a";
          }}
        />
        {selectedEdge ? (
          <Panel position="top-center">
            <div className="flex items-center gap-2 border border-line bg-bg/95 px-2.5 py-1.5 text-[12px] text-muted backdrop-blur-sm">
              <span className="max-w-48 truncate text-text">{selectedEdge.target}</span>
              <span>starts</span>
              <GateSelect
                value={selectedEdge.dep.gate}
                onChange={(gate) =>
                  dispatch({ type: "connect", source: selectedEdge.dep.source, target: selectedEdge.dep.target, gate })
                }
              />
              <span>after</span>
              <span className="max-w-48 truncate text-text">{selectedEdge.source}</span>
              <span className={selectedEdge.open ? "text-completed" : "text-blocked"}>
                {selectedEdge.open ? "Open" : "Closed"}
              </span>
              <Button
                variant="quiet"
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
        <Panel position="bottom-center">
          <div className="flex items-center gap-2 border border-line bg-bg/90 px-2 py-1 text-[10px] text-muted backdrop-blur-sm">
            {STATUSES.map((status) => (
              <span key={status} className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${statusBg[status]}`} />
                {STATUS_LABEL[status]}
              </span>
            ))}
          </div>
        </Panel>
      </ReactFlow>
      {ui.contextMenu ? <TaskMenu /> : null}
      {projectTasks.length === 0 ? (
        <Overlay>
          <div className="text-[13px] text-text">No tasks on this canvas.</div>
          <p className="mt-1 max-w-sm text-[12px] leading-5 text-muted">Create a task or decompose an objective. The graph is the workspace.</p>
          <Button className="mt-3" variant="primary" onClick={() => setNewTaskOpen(true)}>
            New task
          </Button>
        </Overlay>
      ) : null}
      {projectTasks.length > 0 && visibleCount === 0 ? (
        <Overlay>
          <div className="text-[13px] text-text">Nothing matches these filters.</div>
          <Button className="mt-3" variant="ghost" onClick={() => setFilters(initialFilters)}>
            Clear filters
          </Button>
        </Overlay>
      ) : null}
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto border border-line bg-surface px-4 py-3">{children}</div>
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
  const [reassigning, setReassigning] = useState(false);
  if (!menu || !task) return null;

  const close = () => setContextMenu(null);
  const left = Math.min(menu.x, window.innerWidth - 230);
  const top = Math.min(menu.y, window.innerHeight - 320);
  const waiting = task.status === "running" ? null : waitingOn(task, tasks, deps);

  return (
    <div className="fixed z-30 w-56 border border-line bg-surface py-1 text-[12px] shadow-none" style={{ left, top }}>
      {waiting ? <div className="px-2.5 py-1.5 text-[11px] leading-4 text-blocked">{waiting}</div> : null}
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
        <div className="max-h-36 overflow-auto border-y border-line py-1">
          {AGENTS.map((agent) => (
            <MenuItem
              key={agent.id}
              label={agent.name}
              hint={agent.model}
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
      className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-surface-2 ${danger ? "text-failed" : "text-text"}`}
    >
      <span>{label}</span>
      {hint ? <span className="font-mono text-[10px] text-faint">{hint}</span> : null}
    </button>
  );
}
