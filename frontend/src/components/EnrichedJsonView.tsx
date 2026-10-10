import { useState } from 'react'
import { Copy, Check, Download, FileCode, ChevronDown, ChevronUp } from 'lucide-react'

export function EnrichedJsonView({ data, ideaId }: { data: any; ideaId?: string }) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Build clean representation, omitting circular references or internal frontend metadata if desired
  const jsonString = JSON.stringify(data, null, 2)
  const sizeKb = (new Blob([jsonString]).size / 1024).toFixed(1)
  const cleanId = ideaId?.replace(/^engine-/, '') || 'enriched-idea'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const textArea = document.createElement('textarea')
      textArea.value = jsonString
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${cleanId}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  return (
    <section className="enriched-json-panel" aria-label="Full Enriched JSON Output">
      <div className="json-header-bar">
        <div className="json-title-group">
          <FileCode size={17} className="json-icon" />
          <div className="json-title-meta">
            <h3 className="panel-title">Full Enriched JSON Output</h3>
            <span className="json-meta-sub">{sizeKb} KB · UTF-8 formatted</span>
          </div>
        </div>

        <div className="json-actions">
          <button
            type="button"
            className="json-action-btn copy-btn"
            onClick={handleCopy}
            title="Copy full JSON payload to clipboard"
          >
            {copied ? (
              <>
                <Check size={14} className="copied-icon" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>Copy JSON</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="json-action-btn download-btn"
            onClick={handleDownload}
            title="Download JSON file to your device"
          >
            <Download size={14} />
            <span>Download .json</span>
          </button>

          <button
            type="button"
            className="json-action-btn collapse-toggle-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand viewer' : 'Collapse viewer'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="json-code-container">
          <pre className="json-code-pre">
            <code>{jsonString}</code>
          </pre>
        </div>
      )}
    </section>
  )
}
