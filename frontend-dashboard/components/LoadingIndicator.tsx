import { LoaderCircle } from "lucide-react";

export function LoadingIndicator({ label = "Loading" }: { label?: string }) {
  return (
    <span className="loadingIndicator" role="status" aria-live="polite">
      <LoaderCircle size={16} />
      <span>{label}</span>
    </span>
  );
}
