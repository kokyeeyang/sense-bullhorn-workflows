import { WorkflowCatalogItem } from "./types";

export function workflowLabel(
  workflowName: string,
  catalog: WorkflowCatalogItem[] = [],
) {
  return catalog.find((workflow) => workflow.workflowName === workflowName)?.label || workflowName;
}

export function workflowDescription(
  workflowName: string,
  catalog: WorkflowCatalogItem[] = [],
) {
  return catalog.find((workflow) => workflow.workflowName === workflowName)?.description || "";
}

export function sortWorkflowsByLabel<T extends { workflowName: string; label?: string }>(workflows: T[]) {
  return [...workflows].sort((left, right) =>
    (left.label || left.workflowName).localeCompare(right.label || right.workflowName),
  );
}
