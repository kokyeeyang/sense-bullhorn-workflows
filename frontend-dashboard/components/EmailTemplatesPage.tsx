"use client";

import { useEffect, useMemo, useState } from "react";
import { Code2, Eye, Mail, RefreshCcw, Search, X } from "lucide-react";
import { fetchEmailTemplates } from "@/lib/dashboardApi";
import { EmailTemplateItem, EmailTemplatesResponse } from "@/lib/types";
import { formatDateTime, formatNumber } from "@/lib/format";
import { LoadingIndicator } from "@/components/LoadingIndicator";

const REGION_OPTIONS = ["", "Americas", "EMEA", "APAC", "Region agnostic"];

export function EmailTemplatesPage() {
  const [data, setData] = useState<EmailTemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplateItem | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      setData(await fetchEmailTemplates());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Email templates failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const templates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.templates || []).filter((template) => {
      if (region && template.region !== region) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [template.name, template.fileName, template.category, template.sparkPostTemplateKey || ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, query, region]);

  return (
    <main className="pageShell">
      <header className="topBar">
        <div>
          <span className="eyebrow">Template Catalog</span>
          <h1>Email Templates</h1>
        </div>
        <button type="button" className="iconButton" onClick={() => void load()} title="Refresh">
          <RefreshCcw size={18} />
        </button>
      </header>

      <section className="filterPanel templateFilters">
        <div className="filterTitle">
          <Mail size={18} />
          <span>Filters</span>
        </div>
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="termination, benefits" />
        </label>
        <label>
          Region
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            {REGION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option || "All"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primaryButton" onClick={() => void load()}>
          <Search size={16} />
          Refresh
        </button>
      </section>

      {error ? <section className="errorBanner">{error}</section> : null}

      <section className="metricGrid detailMetricGrid">
        <section className="metricCard">
          <div>
            <p>Templates</p>
            {loading && !data ? <LoadingIndicator /> : <strong>{formatNumber(data?.count)}</strong>}
            <span>Local HTML catalog</span>
          </div>
        </section>
        <section className="metricCard">
          <div>
            <p>Visible</p>
            {loading && !data ? <LoadingIndicator /> : <strong>{formatNumber(templates.length)}</strong>}
          </div>
        </section>
        <section className="metricCard">
          <div>
            <p>SparkPost keys</p>
            {loading && !data ? (
              <LoadingIndicator />
            ) : (
              <strong>{formatNumber((data?.templates || []).filter((template) => template.sparkPostTemplateKey).length)}</strong>
            )}
          </div>
        </section>
      </section>

      <section className="panel fullWidth">
        <div className="panelHeader">
          <div>
            <span className="eyebrow">HTML</span>
            <h2>Template Library</h2>
          </div>
          {loading ? <LoadingIndicator label="Loading templates" /> : null}
        </div>

        {loading && !data ? (
          <LoadingIndicator label="Loading template catalog" />
        ) : (
        <div className="templateTileGrid">
          {templates.map((template) => (
            <button
              type="button"
              className="templateTile"
              key={template.fileName}
              onClick={() => setSelectedTemplate(template)}
            >
              <div className="templateTileTop">
                <strong>{template.name}</strong>
                <span>{template.region}</span>
              </div>
              <p>{template.fileName}</p>
              <div className="templateTileMeta">
                <span>{template.category}</span>
                <span>{Math.ceil(template.sizeBytes / 1024)} KB</span>
              </div>
              {template.sparkPostTemplateKey ? <small>{template.sparkPostTemplateKey}</small> : null}
            </button>
          ))}
        </div>
        )}

        {!loading && templates.length === 0 ? <p className="emptyText">No templates match the current filters.</p> : null}
        {data?.generatedAt ? <p className="scheduleFootnote">Catalog refreshed {formatDateTime(data.generatedAt)}</p> : null}
      </section>

      {selectedTemplate ? (
        <TemplateModal template={selectedTemplate} onClose={() => setSelectedTemplate(null)} />
      ) : null}
    </main>
  );
}

function TemplateModal({ template, onClose }: { template: EmailTemplateItem; onClose: () => void }) {
  const [view, setView] = useState<"preview" | "source">("preview");

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel templateModalPanel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <span className="eyebrow">Email Template</span>
            <h2>{template.name}</h2>
          </div>
          <button type="button" className="iconButton" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        <div className="detailGrid">
          <div>
            <span>File</span>
            <strong>{template.fileName}</strong>
          </div>
          <div>
            <span>Region</span>
            <strong>{template.region}</strong>
          </div>
          <div>
            <span>SparkPost key</span>
            <strong>{template.sparkPostTemplateKey || "-"}</strong>
          </div>
        </div>

        <div className="templateModalTabs">
          <button type="button" className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>
            <Eye size={16} />
            Preview
          </button>
          <button type="button" className={view === "source" ? "active" : ""} onClick={() => setView("source")}>
            <Code2 size={16} />
            HTML
          </button>
        </div>

        {view === "preview" ? (
          <iframe className="templatePreviewFrame" title={`${template.name} preview`} srcDoc={template.html} />
        ) : (
          <section className="modalSection">
            <pre>{template.html}</pre>
          </section>
        )}
      </section>
    </div>
  );
}
