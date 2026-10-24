"use client";

/**
 * ActionGraph – React Flow canvas for visualising a case's dependency graph.
 *
 * Uses @xyflow/react v12 API.
 * Responsibilities:
 *   • Derives nodes/edges from persisted actions via domain/graph helpers.
 *   • Provides pan, zoom, and fit-to-view.
 *   • Raises onNodeSelect when a node is clicked.
 *   • Handles empty, loading, and error states gracefully.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { buildEdges, buildNodes } from "../../domain/graph";
import type { ActionNodeData } from "../../domain/graph";
import type { Action } from "../../domain/types";
import ActionNode from "./ActionNode";

// Register custom node types outside component to keep stable reference
const nodeTypes = { actionNode: ActionNode };

interface Props {
  actions: Action[];
  selectedActionId: string | null;
  onNodeSelect: (action: Action | null) => void;
}

// ─── Inner canvas (needs ReactFlowProvider context) ──────────────────────────

function GraphCanvas({ actions, selectedActionId, onNodeSelect }: Props) {
  const { fitView } = useReactFlow();
  const fittedRef = useRef(false);

  const nodes = useMemo(() => buildNodes(actions), [actions]);
  const edges = useMemo(() => buildEdges(actions), [actions]);

  // Mark selected node
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedActionId,
      })),
    [nodes, selectedActionId],
  );

  // Fit on first load
  useEffect(() => {
    if (!fittedRef.current && nodes.length) {
      setTimeout(() => {
        fitView({ padding: 0.15, duration: 400 });
        fittedRef.current = true;
      }, 100);
    }
  }, [nodes, fitView]);

  // Re-fit when actions change (e.g. after status update)
  useEffect(() => {
    if (fittedRef.current && nodes.length) {
      fitView({ padding: 0.15, duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      const action = actions.find((a) => a.id === node.id);
      onNodeSelect(action ?? null);
    },
    [actions, onNodeSelect],
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  if (!actions.length) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <p>No actions in this case.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      style={{ background: "#07111f" }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="#1e293b"
      />
      <Controls
        showInteractive={false}
        className="[&>button]:!bg-slate-900 [&>button]:!border-slate-700 [&>button]:!text-slate-300 [&>button:hover]:!bg-slate-800"
        aria-label="Graph controls"
      />
      <MiniMap
        nodeColor={(n) => {
          const data = n.data as unknown as ActionNodeData;
          const status = data?.action?.status;
          const colors: Record<string, string> = {
            completed: "#34d399",
            in_progress: "#a78bfa",
            awaiting_approval: "#fb923c",
            ready: "#60a5fa",
            pending: "#475569",
            blocked: "#fbbf24",
            failed: "#f87171",
          };
          return colors[status] ?? "#475569";
        }}
        style={{ background: "#0f172a", border: "1px solid #1e293b" }}
        maskColor="rgba(15,23,42,0.7)"
        aria-label="Graph minimap"
      />
    </ReactFlow>
  );
}

// ─── Exported wrapper (provides ReactFlowProvider) ───────────────────────────

export default function ActionGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
