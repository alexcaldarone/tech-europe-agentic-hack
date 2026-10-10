import { useLayoutEffect, useRef } from 'react'
import type { Idea } from './ideaWorkspace'
import { AbstractSymbol } from './BrandShape'
import { KeyConclusionCard } from './components/KeyConclusionCard'
import { ProsConsView } from './components/ProsConsView'
import { OpenQuestionsView } from './components/OpenQuestionsView'
import { CompetitorsView } from './components/CompetitorsView'
import { DiagramsView } from './components/DiagramsView'
import { EnrichedJsonView } from './components/EnrichedJsonView'
import { Users, ThumbsUp, ThumbsDown, Sparkles } from 'lucide-react'

function TextBlock({
  value,
  label,
  className,
  placeholder,
  onChange,
  singleLine = false,
}: {
  value: string
  label: string
  className: string
  placeholder: string
  onChange: (value: string) => void
  singleLine?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    const resize = () => {
      input.style.height = '0px'
      input.style.height = `${input.scrollHeight}px`
    }
    resize()
    const observer = new ResizeObserver(resize)
    if (input.parentElement) observer.observe(input.parentElement)
    return () => observer.disconnect()
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label}
      className={`editable-block ${className}`}
      value={value}
      placeholder={placeholder}
      onChange={(event) =>
        onChange(singleLine ? event.target.value.replace(/[\r\n]+/g, ' ') : event.target.value)
      }
      onKeyDown={(event) => {
        if (singleLine && event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function EditableIdea({
  idea,
  onChange,
  storageError,
}: {
  idea: Idea
  onChange: (fields: Partial<Pick<Idea, 'title' | 'summary' | 'tag'>>) => void
  storageError: boolean
}) {
  // Extract key conclusion from metadata, pros_cons, or root fields
  const keyConclusion =
    idea.metadata?.key_takeaway ||
    idea.metadata?.key_conclusion ||
    idea.conclusion ||
    idea.pros_cons?.summary

  // Build clean representation of raw idea for full enriched JSON
  const rawData = idea.rawIdea || idea

  const hasParticipants = Boolean(idea.proponents?.length || idea.opponents?.length)

  return (
    <div className="enriched-idea-container">
      {/* Top Symbol & Header Block */}
      <div className="idea-header-block">
        <AbstractSymbol className="idea-page-symbol" />
        <div className="idea-meta-badges">
          {idea.status && (
            <span className={`status-pill status-${idea.status}`}>
              <Sparkles size={11} />
              <span>{idea.status}</span>
            </span>
          )}
          {idea.votes !== undefined && idea.votes > 0 && (
            <span className="votes-pill">
              ★ {idea.votes} {idea.votes === 1 ? 'vote' : 'votes'}
            </span>
          )}
        </div>
      </div>

      {/* 1. Editable Title */}
      <div className="idea-editor-title" role="heading" aria-level={1}>
        <TextBlock
          label="Idea title"
          className="editable-title"
          value={idea.title}
          placeholder="Untitled idea"
          singleLine
          onChange={(title) => onChange({ title })}
        />
      </div>

      {/* Tag input */}
      <div className="idea-tag-row">
        <input
          className="editable-tag idea-tag"
          aria-label="Idea tag"
          value={idea.tag}
          placeholder="Add a tag"
          onChange={(event) => onChange({ tag: event.target.value })}
        />
      </div>

      {/* 2. Idea Summary */}
      <div className="idea-summary-section">
        <label className="section-eyebrow-label">Executive Summary</label>
        <div className="idea-editor-body">
          <TextBlock
            label="Idea content"
            className="editable-body"
            value={idea.summary}
            placeholder="Start writing your idea…"
            onChange={(summary) => onChange({ summary })}
          />
        </div>
      </div>

      <small className={`editor-save-status ${storageError ? 'save-error' : ''}`} role="status">
        {storageError
          ? 'Could not save in this browser. Keep this tab open to retain your edits.'
          : 'Click any text to edit · Saved in this browser'}
      </small>

      {/* 3. Key Conclusion so Far */}
      {keyConclusion && (
        <KeyConclusionCard
          takeaway={idea.metadata?.key_takeaway}
          conclusion={idea.conclusion}
          fallback={keyConclusion}
        />
      )}

      {/* Discussion Voice Champions (Proponents & Opponents) */}
      {hasParticipants && (
        <div className="participants-brief-row">
          <div className="participants-group">
            <span className="participants-label">
              <Users size={13} />
              <span>Discussion Voices:</span>
            </span>
            {Boolean(idea.proponents?.length) && (
              <span className="voice-badge proponents-badge">
                <ThumbsUp size={11} />
                <span>{idea.proponents?.length} Champions</span>
              </span>
            )}
            {Boolean(idea.opponents?.length) && (
              <span className="voice-badge opponents-badge">
                <ThumbsDown size={11} />
                <span>{idea.opponents?.length} Skeptics</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 4. Pros & Cons identified from body (Categorized & Sorted) - Matches Image 1 */}
      <ProsConsView data={idea.pros_cons} />

      {/* Questions remain visible independently of the pros/cons analysis. */}
      <OpenQuestionsView questions={idea.pros_cons?.open_questions} />

      {/* 5. Competitors Discovered via Google Search - Matches Image 2 */}
      <CompetitorsView data={idea.competitors} />

      {/* 6. Visual Diagrams (Process Workflow & System Architecture) */}
      <DiagramsView
        workflow={idea.workflow}
        systemGraph={idea.systemGraph}
        ideaId={idea.id}
      />

      {/* 7. Full Enriched JSON Output (Copy & Download) */}
      <EnrichedJsonView data={rawData} ideaId={idea.id} />
    </div>
  )
}
