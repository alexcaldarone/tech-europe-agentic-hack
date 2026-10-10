import { useState } from 'react'
import { ArrowRight, Boxes, ExternalLink, GitBranch, Network } from 'lucide-react'
import type { ArchitectureEnrichment, WorkflowEnrichment } from '../ideaWorkspace'
import { MermaidDiagram } from './MermaidDiagram'

type DiagramTab = 'workflow' | 'architecture'

function artifactUrl(ideaId: string | undefined, filename: string) {
  const cleanId = ideaId?.replace(/^engine-/, '')
  if (!cleanId) return null
  const base = (import.meta.env.VITE_ENRICHMENT_URL || '/api/enrichment').replace(/\/$/, '')
  return `${base}/ideas/${encodeURIComponent(cleanId)}/artifacts/${filename}`
}

export function DiagramsView({
  workflow,
  systemGraph,
  ideaId,
}: {
  workflow?: WorkflowEnrichment | null
  systemGraph?: ArchitectureEnrichment | null
  ideaId?: string
}) {
  const hasWorkflow = Boolean(workflow && (workflow.steps?.length || workflow.mermaid_code || workflow.mermaidCode || workflow.summary))
  const hasArchitecture = Boolean(systemGraph && (systemGraph.nodes?.length || systemGraph.edges?.length || systemGraph.mermaid_code || systemGraph.summary))
  const [requestedTab, setRequestedTab] = useState<DiagramTab>(hasWorkflow ? 'workflow' : 'architecture')

  if (!hasWorkflow && !hasArchitecture) return null

  const activeTab: DiagramTab = requestedTab === 'workflow' && !hasWorkflow
    ? 'architecture'
    : requestedTab === 'architecture' && !hasArchitecture
      ? 'workflow'
      : requestedTab

  const cleanId = ideaId?.replace(/^engine-/, '') || 'idea'
  const workflowCode = workflow?.mermaid_code || workflow?.mermaidCode
  const workflowSvg = artifactUrl(ideaId, 'workflow.svg')
  const architectureSvg = artifactUrl(ideaId, 'system-architecture.svg')

  return (
    <section className="diagrams-panel" aria-labelledby="diagrams-heading">
      <div className="diagrams-header-bar">
        <div className="diagrams-title-group">
          <span className="diagrams-heading-icon" aria-hidden="true"><Boxes size={19} /></span>
          <div>
            <h3 className="panel-title" id="diagrams-heading">Process &amp; System Design</h3>
            <p>How the idea works from input to outcome.</p>
          </div>
        </div>

        <div className="diagram-tabs" role="tablist" aria-label="Diagram type">
          {hasWorkflow && (
            <button type="button" role="tab" aria-selected={activeTab === 'workflow'} className={`diagram-tab-btn ${activeTab === 'workflow' ? 'active' : ''}`} onClick={() => setRequestedTab('workflow')}>
              <GitBranch size={14} /> Process
            </button>
          )}
          {hasArchitecture && (
            <button type="button" role="tab" aria-selected={activeTab === 'architecture'} className={`diagram-tab-btn ${activeTab === 'architecture' ? 'active' : ''}`} onClick={() => setRequestedTab('architecture')}>
              <Network size={14} /> Architecture
            </button>
          )}
        </div>
      </div>

      {activeTab === 'workflow' && workflow && (
        <div className="diagram-content-container" role="tabpanel">
          {workflow.summary && <p className="diagram-intro">{workflow.summary}</p>}

          {Boolean(workflow.steps?.length) && (
            <div>
              <div className="diagram-section-label">Execution flow · {workflow.steps?.length} stages</div>
              <div className="process-flow">
                {workflow.steps?.map((step, index) => (
                  <div className="process-stage-wrap" key={`${index}-${step}`}>
                    <article className="process-stage">
                      <span className="process-stage-number">{String(index + 1).padStart(2, '0')}</span>
                      <p>{step}</p>
                    </article>
                    {index < (workflow.steps?.length || 0) - 1 && <ArrowRight className="process-connector" size={17} aria-hidden="true" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {workflowCode && (
            <div className="diagram-map-block">
              <div className="diagram-map-heading">
                <span>Detailed workflow map</span>
                {workflowSvg && <a href={workflowSvg} target="_blank" rel="noreferrer">Open SVG <ExternalLink size={11} /></a>}
              </div>
              <MermaidDiagram code={workflowCode} idPrefix={`wf-${cleanId}`} label="Detailed workflow diagram" />
            </div>
          )}
        </div>
      )}

      {activeTab === 'architecture' && systemGraph && (
        <div className="diagram-content-container" role="tabpanel">
          {systemGraph.summary && <p className="diagram-intro">{systemGraph.summary}</p>}

          {Boolean(systemGraph.nodes?.length) && (
            <div>
              <div className="diagram-section-label">System components · {systemGraph.nodes?.length} modules</div>
              <div className="nodes-grid">
                {systemGraph.nodes?.map(node => (
                  <article className="component-node-card" key={node.id}>
                    <span className={`node-type-badge type-${node.component_type || 'service'}`}>{node.component_type || 'service'}</span>
                    <strong className="node-label">{node.label}</strong>
                    {node.description && <p className="node-desc">{node.description}</p>}
                  </article>
                ))}
              </div>
            </div>
          )}

          {systemGraph.mermaid_code && (
            <div className="diagram-map-block">
              <div className="diagram-map-heading">
                <span>System map</span>
                {architectureSvg && <a href={architectureSvg} target="_blank" rel="noreferrer">Open SVG <ExternalLink size={11} /></a>}
              </div>
              <MermaidDiagram code={systemGraph.mermaid_code} idPrefix={`arch-${cleanId}`} label="System architecture diagram" />
            </div>
          )}

          {Boolean(systemGraph.edges?.length) && (
            <div className="architecture-connections">
              <div className="diagram-section-label">Connections · {systemGraph.edges?.length}</div>
              <div className="connection-list">
                {systemGraph.edges?.map((edge, index) => (
                  <div className="connection-row" key={`${index}-${edge.source}-${edge.target}`}>
                    <code>{edge.source}</code><ArrowRight size={13} aria-hidden="true" /><code>{edge.target}</code>
                    {edge.label && <span>{edge.label}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
