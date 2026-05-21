"use client";

import { useEffect, useMemo, useState } from "react";
import { Code2, Eye, Mail, RefreshCcw, Search, X } from "lucide-react";
import { fetchEmailTemplates } from "@/lib/dashboardApi";
import { EmailTemplateItem, EmailTemplatesResponse } from "@/lib/types";
import { formatDateTime, formatNumber } from "@/lib/format";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FreshnessStatus } from "@/components/FreshnessStatus";

const REGION_OPTIONS = ["", "Americas", "EMEA", "APAC", "Region agnostic"];
const MAPPING_OPTIONS = ["", "mapped", "unmapped"] as const;
type MappingFilter = (typeof MAPPING_OPTIONS)[number];

export function EmailTemplatesPage() {
  const [data, setData] = useState<EmailTemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [mapping, setMapping] = useState<MappingFilter>("");
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

  const workflowOptions = useMemo(() => {
    const workflowMap = new Map<string, string>();
    for (const template of data?.templates || []) {
      for (const usage of template.usedBy || []) {
        workflowMap.set(usage.workflowName, usage.workflowLabel);
      }
    }

    return Array.from(workflowMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [data]);

  const templates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.templates || []).filter((template) => {
      if (region && template.region !== region) {
        return false;
      }
      if (workflowName && !template.usedBy.some((usage) => usage.workflowName === workflowName)) {
        return false;
      }
      if (mapping === "mapped" && template.usedBy.length === 0) {
        return false;
      }
      if (mapping === "unmapped" && template.usedBy.length > 0) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [
        template.name,
        template.fileName,
        template.category,
        template.sparkPostTemplateKey || "",
        ...template.usedBy.flatMap((usage) => [
          usage.workflowName,
          usage.workflowLabel,
          usage.role,
          usage.configKey || "",
          usage.ruleKey || "",
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, mapping, query, region, workflowName]);

  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, { label: string; templates: EmailTemplateItem[] }>();

    for (const template of templates) {
      const templateWorkflows = workflowName
        ? template.usedBy.filter((usage) => usage.workflowName === workflowName)
        : template.usedBy;

      if (templateWorkflows.length === 0) {
        const group = groups.get("unmapped") || { label: "Unmapped templates", templates: [] };
        group.templates.push(template);
        groups.set("unmapped", group);
        continue;
      }

      const workflowKeys = new Set<string>();
      for (const usage of templateWorkflows) {
        if (workflowKeys.has(usage.workflowName)) {
          continue;
        }
        workflowKeys.add(usage.workflowName);
        const group = groups.get(usage.workflowName) || { label: usage.workflowLabel, templates: [] };
        group.templates.push(template);
        groups.set(usage.workflowName, group);
      }
    }

    return Array.from(groups.entries())
      .map(([key, group]) => ({ key, ...group }))
      .sort((left, right) => {
        if (left.key === "unmapped") return 1;
        if (right.key === "unmapped") return -1;
        return left.label.localeCompare(right.label);
      });
  }, [templates, workflowName]);

  const mappedTemplateCount = (data?.templates || []).filter((template) => template.usedBy.length > 0).length;

  return (
    <main className="pageShell">
      <header className="topBar">
        <div>
          <span className="eyebrow">Template Catalog</span>
          <h1>Email Templates</h1>
        </div>
        <div className="topActions">
          <FreshnessStatus
            primaryGeneratedAt={data?.generatedAt || null}
            primaryLabel="data"
            loading={loading}
            error={error}
          />
          <button type="button" className="iconButton" onClick={() => void load()} title="Refresh">
            <RefreshCcw size={18} />
          </button>
        </div>
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
        <label>
          Workflow
          <select value={workflowName} onChange={(event) => setWorkflowName(event.target.value)}>
            <option value="">All</option>
            {workflowOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mapping
          <select value={mapping} onChange={(event) => setMapping(event.target.value as MappingFilter)}>
            <option value="">All</option>
            <option value="mapped">Mapped</option>
            <option value="unmapped">Unmapped</option>
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
        <section className="metricCard">
          <div>
            <p>Mapped</p>
            {loading && !data ? <LoadingIndicator /> : <strong>{formatNumber(mappedTemplateCount)}</strong>}
            <span>Connected to workflows</span>
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
          <div className="templateWorkflowGroups">
            {groupedTemplates.map((group) => (
              <section className="templateWorkflowGroup" key={group.key}>
                <div className="templateWorkflowGroupHeader">
                  <strong>{group.label}</strong>
                  <span>{formatNumber(group.templates.length)}</span>
                </div>
                <div className="templateTileGrid">
                  {group.templates.map((template) => (
                    <TemplateTile
                      key={`${group.key}:${template.fileName}`}
                      template={template}
                      onClick={() => setSelectedTemplate(template)}
                    />
                  ))}
                </div>
              </section>
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

function TemplateTile({ template, onClick }: { template: EmailTemplateItem; onClick: () => void }) {
  const workflowLabels = Array.from(new Set(template.usedBy.map((usage) => usage.workflowLabel)));

  return (
    <button type="button" className="templateTile" onClick={onClick}>
      <div className="templateTileTop">
        <strong>{template.name}</strong>
        <span>{template.region}</span>
      </div>
      <p>{template.fileName}</p>
      <div className="templateTileMeta">
        <span>{template.category}</span>
        <span>{Math.ceil(template.sizeBytes / 1024)} KB</span>
      </div>
      <div className="templateUsageSummary">
        {workflowLabels.length > 0 ? (
          <>
            <span>Used by</span>
            <strong>{workflowLabels.slice(0, 2).join(", ")}</strong>
            {workflowLabels.length > 2 ? <small>+{workflowLabels.length - 2} more</small> : null}
          </>
        ) : (
          <strong>Unmapped</strong>
        )}
      </div>
      {template.sparkPostTemplateKey ? <small>{template.sparkPostTemplateKey}</small> : null}
    </button>
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

        <section className="modalSection">
          <h3>Used By</h3>
          {template.usedBy.length > 0 ? (
            <div className="templateUsageList">
              {template.usedBy.map((usage) => (
                <div className="templateUsageItem" key={`${usage.workflowName}:${usage.role}:${usage.ruleKey || usage.configKey || "default"}`}>
                  <div>
                    <strong>{usage.workflowLabel}</strong>
                    <span>{usage.role}</span>
                  </div>
                  <div className="templateUsageMeta">
                    <span>{usage.sendMethod === "sparkpost-template" ? "SparkPost template" : "Inline HTML"}</span>
                    {usage.ruleKey ? <span>{usage.ruleKey}</span> : null}
                    {usage.configKey ? <span>{usage.configKey}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="emptyText">No workflow mapping has been registered for this template yet.</p>
          )}
        </section>

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
