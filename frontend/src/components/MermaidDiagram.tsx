import { useEffect, useState } from 'react'
import mermaid from 'mermaid'
import { Code, Eye } from 'lucide-react'

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  flowchart: { curve: 'basis', htmlLabels: true },
  themeVariables: {
    darkMode: false,
    background: '#ffffff',
    primaryColor: '#eef2ff',
    primaryTextColor: '#18181b',
    primaryBorderColor: '#818cf8',
    lineColor: '#71717a',
    secondaryColor: '#ecfeff',
    tertiaryColor: '#fafafa',
    fontFamily: 'Supreme, Inter, system-ui, sans-serif',
  },
})

export function MermaidDiagram({ code, idPrefix = 'mermaid', label = 'Diagram' }: { code?: string | null; idPrefix?: string; label?: string }) {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const normalizedCode = code
    ?.trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  useEffect(() => {
    let isMounted = true
    const renderDiagram = async () => {
      if (!normalizedCode) {
        setSvg('')
        setError(null)
        return
      }
      try {
        const id = `${idPrefix}-${Math.random().toString(36).substring(2, 9)}`
        const result = await mermaid.render(id, normalizedCode)
        if (isMounted) {
          setSvg(result.svg)
          setError(null)
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to render diagram')
        }
      }
    }
    renderDiagram()
    return () => {
      isMounted = false
    }
  }, [normalizedCode, idPrefix])

  if (!normalizedCode) return null

  return (
    <div className="mermaid-container" aria-label={label}>
      <div className="mermaid-header-bar">
        <span className="diagram-type-tag">Interactive map</span>
        <button
          type="button"
          className="code-toggle-btn"
          onClick={() => setShowRaw(!showRaw)}
          title={showRaw ? 'Switch to visual diagram' : 'View mermaid source syntax'}
        >
          {showRaw ? <><Eye size={13} /> Visual Diagram</> : <><Code size={13} /> Mermaid Syntax</>}
        </button>
      </div>

      {showRaw ? (
        <pre className="diagram-raw-pre">
          <code>{normalizedCode}</code>
        </pre>
      ) : error ? (
        <div className="diagram-fallback">
          <p className="diagram-error-hint">Rendering fallback (syntax view):</p>
          <pre className="diagram-raw-pre">
            <code>{normalizedCode}</code>
          </pre>
        </div>
      ) : (
        <div
          className="mermaid-rendered-svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  )
}
