import s from "@/app/app/pages.module.css";

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className={s.rows} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className={s.skeleton} />
      ))}
    </div>
  );
}

export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className={s.error} role="alert">
      <span>{message}</span>
      {retry && (
        <button className="btn btn-ghost btn-sm" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function DataNote({ data, agent }: { data: "live" | "sample"; agent: string | null }) {
  return (
    <span className="tag" title={agent ? `Agent model: ${agent}` : "Set ANTHROPIC_API_KEY to turn the agent on"}>
      <span className="dot" style={{ color: data === "live" ? "var(--good)" : "var(--warning)" }} />
      {data === "live" ? "Live SoSoValue data" : "Sample data"}
      {agent ? ", agent on" : ", agent off"}
    </span>
  );
}
