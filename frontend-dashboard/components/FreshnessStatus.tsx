import { formatDateTime } from "@/lib/format";

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function FreshnessStatus({
  environment,
  primaryGeneratedAt,
  primaryLabel = "data",
  loading = false,
  error,
}: {
  environment?: string | null;
  primaryGeneratedAt?: string | null;
  primaryLabel?: string;
  loading?: boolean;
  error?: string | null;
}) {
  const environmentLabel = environment ? titleCase(String(environment)) : null;
  const refreshLabel = error
    ? `${primaryLabel} unavailable`
    : loading && !primaryGeneratedAt
      ? `${primaryLabel} refreshing`
      : primaryGeneratedAt
        ? `${primaryLabel} last refreshed ${formatDateTime(primaryGeneratedAt)}`
        : `${primaryLabel} pending`;

  return (
    <div className="freshnessStatus" aria-label="Dashboard environment and freshness">
      {environmentLabel ? <span>{environmentLabel}, </span> : null}
      <span>{refreshLabel}</span>
    </div>
  );
}
