import { HelpCircle } from 'lucide-react'

export function OpenQuestionsView({ questions }: { questions?: string[] | null }) {
  const visibleQuestions = (questions || []).map(question => question.trim()).filter(Boolean)

  if (visibleQuestions.length === 0) return null

  return (
    <section className="open-questions-section" aria-labelledby="open-questions-heading">
      <div className="open-questions-header">
        <span className="open-questions-icon" aria-hidden="true"><HelpCircle size={18} /></span>
        <div>
          <h3 id="open-questions-heading">Open Questions</h3>
          <p>Decisions and unknowns the team still needs to resolve.</p>
        </div>
        <span className="open-questions-count" aria-label={`${visibleQuestions.length} open questions`}>
          {visibleQuestions.length}
        </span>
      </div>
      <ol className="open-questions-list">
        {visibleQuestions.map((question, index) => (
          <li key={`${index}-${question}`}>
            <span aria-hidden="true">{index + 1}</span>
            <p>{question}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
