import { Search, Calendar, ExternalLink, Globe } from 'lucide-react'
import type { CompetitorEnrichment } from '../ideaWorkspace'

export function CompetitorsView({ data }: { data?: CompetitorEnrichment | null }) {
  if (!data || (!data.competitors?.length && !data.summary && !data.market_landscape)) {
    return null
  }

  const landscape = data.market_landscape || data.summary
  const competitors = data.competitors || []

  return (
    <section className="competitors-panel" aria-label="Competitor Analysis">
      {/* Header bar matching Image 2 */}
      <div className="panel-header">
        <div className="panel-title-group">
          <Search size={17} className="panel-search-icon" aria-hidden="true" />
          <h3 className="panel-title">Competitors Discovered via Google Search</h3>
        </div>
        <div className="grounded-badge">
          <Globe size={13} className="grounded-icon" />
          <span>Live Web Grounded</span>
        </div>
      </div>

      {/* Landscape summary paragraph in italics */}
      {landscape && (
        <p className="panel-summary-narrative">{landscape}</p>
      )}

      {/* List of Competitor Cards */}
      <div className="competitors-stack">
        {competitors.map((comp, idx) => {
          const foundedLabel = comp.yearOfFounding
            ? (comp.yearOfFounding.toLowerCase().startsWith('founded') ? comp.yearOfFounding : `Founded ${comp.yearOfFounding}`)
            : null

          const ideaText = comp.idea || comp.summary || 'Context-aware automated solution.'
          const bioText = comp.shortBio || comp.summary || 'Enterprise tooling in this domain.'
          const diffText = comp.howWeDiffer || comp.differentiator || data.our_positioning || 'Provides closed-loop verification and bespoke orchestration.'

          return (
            <div key={idx} className="competitor-card">
              {/* Header row: Name + Founded badge */}
              <div className="competitor-card-header">
                <h4 className="competitor-name">{comp.name}</h4>
                {foundedLabel && (
                  <span className="founded-badge">
                    <Calendar size={13} className="calendar-icon" />
                    <span>{foundedLabel}</span>
                  </span>
                )}
              </div>

              {/* Two columns: THEIR IDEA and SHORT BIO */}
              <div className="competitor-details-grid">
                <div className="competitor-subcol">
                  <span className="subcol-label">THEIR IDEA</span>
                  <p className="subcol-text">{ideaText}</p>
                </div>
                <div className="competitor-subcol">
                  <span className="subcol-label">SHORT BIO</span>
                  <p className="subcol-text">{bioText}</p>
                </div>
              </div>

              {/* Full-width callout: HOW WE DIFFER */}
              <div className="how-we-differ-box">
                <span className="differ-label">HOW WE DIFFER</span>
                <p className="differ-text">{diffText}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Grounding sources footer */}
      {Boolean(data.groundingSources?.length) && (
        <div className="grounding-sources-row">
          <span className="sources-label">Verified Sources:</span>
          <div className="sources-chips">
            {data.groundingSources?.map((url, i) => {
              let domain = url
              try {
                domain = new URL(url).hostname.replace(/^www\./, '')
              } catch {
                // Keep raw
              }
              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="source-chip"
                >
                  <span>{domain}</span>
                  <ExternalLink size={11} />
                </a>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
