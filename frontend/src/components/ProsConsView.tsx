import { useState } from 'react'
import { TrendingUp, ShieldAlert, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Scale } from 'lucide-react'
import type { ProsConsEnrichment, ProConItem } from '../ideaWorkspace'

function normalizeItem(item: ProConItem | string): ProConItem {
  if (typeof item === 'string') return { point: item, category: 'Discussion', severity_or_impact: 'Medium', source_context: '' }
  return item
}

export function ProsConsView({ data }: { data?: ProsConsEnrichment | null }) {
  const [showExtended, setShowExtended] = useState(false)

  if (!data || (!data.pros?.length && !data.cons?.length && !data.summary)) return null

  const pros = (data.pros || []).map(normalizeItem)
  const cons = (data.cons || []).map(normalizeItem)
  const hasExtended = Boolean(data.key_risks?.length || data.assumptions?.length)

  return (
    <section className="pros-cons-panel" aria-label="Pros and Cons Analysis">
      <div className="panel-header">
        <div className="panel-title-group"><Scale size={18} className="panel-emoji-icon" aria-hidden="true" /><h3 className="panel-title">Pros &amp; Cons Identified from Body</h3></div>
        <span className="panel-header-badge">Sorted by impact</span>
      </div>

      {data.summary && <p className="panel-summary-narrative">{data.summary}</p>}

      <div className="pros-cons-columns">
        <div className="column-pane pros-column">
          <div className="column-header pros-heading"><TrendingUp size={16} /><h4>Pros voiced in discussion</h4></div>
          <div className="cards-stack">
            {pros.map((pro, index) => {
              const impact = pro.severity_or_impact || 'Medium'
              return <article key={index} className="argument-card pro-card">
                <div className="card-top-row"><span className="card-category">{pro.category || 'General'}</span><span className={`impact-badge impact-${impact.toLowerCase()}`}>{impact} Impact</span></div>
                <p className="card-point">{pro.point}</p>
                {pro.source_context && <blockquote className="card-quote">&ldquo;{pro.source_context.replace(/^["“”]|["“”]$/g, '').trim()}&rdquo;</blockquote>}
              </article>
            })}
            {pros.length === 0 && <p className="no-items-hint">No pros recorded yet.</p>}
          </div>
        </div>

        <div className="column-pane cons-column">
          <div className="column-header cons-heading"><ShieldAlert size={16} /><h4>Cons voiced in discussion</h4></div>
          <div className="cards-stack">
            {cons.map((con, index) => {
              const risk = con.severity_or_impact || 'Medium'
              return <article key={index} className="argument-card con-card">
                <div className="card-top-row"><span className="card-category">{con.category || 'General'}</span><span className={`risk-badge risk-${risk.toLowerCase()}`}>{risk} Risk</span></div>
                <p className="card-point">{con.point}</p>
                {con.source_context && <blockquote className="card-quote">&ldquo;{con.source_context.replace(/^["“”]|["“”]$/g, '').trim()}&rdquo;</blockquote>}
              </article>
            })}
            {cons.length === 0 && <p className="no-items-hint">No cons recorded yet.</p>}
          </div>
        </div>
      </div>

      {hasExtended && <div className="extended-governance-section">
        <button type="button" className="extended-toggle-button" onClick={() => setShowExtended(!showExtended)} aria-expanded={showExtended}>
          <span>Risks &amp; assumptions ({[
            data.key_risks?.length ? `${data.key_risks.length} risks` : null,
            data.assumptions?.length ? `${data.assumptions.length} assumptions` : null,
          ].filter(Boolean).join(' · ')})</span>
          {showExtended ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {showExtended && <div className="extended-grid">
          {Boolean(data.key_risks?.length) && <div className="extended-card risks-card"><h5><AlertTriangle size={14} /> Key Risks</h5><ul>{data.key_risks?.map((risk, index) => <li key={index}>{risk}</li>)}</ul></div>}
          {Boolean(data.assumptions?.length) && <div className="extended-card assumptions-card"><h5><CheckCircle2 size={14} /> Core Assumptions</h5><ul>{data.assumptions?.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        </div>}
      </div>}
    </section>
  )
}
