import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  Columns3,
  LayoutGrid,
  AudioLines,
  Clock3,
  ChevronDown,
  ChevronRight,
  Command,
  Folder,
  FolderOpen,
  Search,
  FileText,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Pause,
  RotateCcw,
  Download,
  Plus,
  X,
} from 'lucide-react'
import './App.css'
import './enrichedView.css'
import { AbstractSymbol, BrandShape, RecordingShape } from './BrandShape'
import { EditableIdea } from './EditableIdea'
import { foldIdeaUpdates, mergeGeneratedIdeas, readWorkspace, workspaceKey } from './ideaWorkspace'
import type { Idea, Session } from './ideaWorkspace'
import { useTranscription } from './useTranscription'

declare const __IDEA_POLL_INTERVAL_MS__: number

const initialSessions: Session[] = [
  { name: 'Hackathon', date: 'Today', ideas: 0 },
  { name: 'Agent onboarding', date: 'Yesterday', ideas: 8 },
  { name: 'Community launch', date: 'Oct 08', ideas: 5 },
  { name: 'A better daily standup', date: 'Oct 04', ideas: 3 },
]

function InfoBanner({ message, role = 'status', loading = false }: { message: string; role?: 'status' | 'alert'; loading?: boolean }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return <div className="info-banner" role={role}><span className="info-banner-content">{loading ? <LoaderCircle className="banner-spinner" size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}<span>{message}</span></span><button type="button" aria-label="Dismiss notification" onClick={() => setDismissed(true)}><X size={16} /></button></div>
}

function getTranscriptWidthBounds() {
  if (typeof window === 'undefined') return { minWidth: 260, maxWidth: 800 }
  const isOverlay = window.innerWidth <= 980
  const minWidth = 260
  const minSidebarAndMain = window.innerWidth <= 1160 ? 610 : 666
  const maxAvailable = isOverlay
    ? window.innerWidth - 60
    : window.innerWidth - minSidebarAndMain
  const maxWidth = Math.max(minWidth, Math.min(800, maxAvailable))
  return { minWidth, maxWidth }
}

function App() {
  const [restored] = useState(() => {
    try { return readWorkspace(localStorage.getItem(workspaceKey)) } catch { return null }
  })
  const [storageError, setStorageError] = useState(false)
  const [sessions, setSessions] = useState(() => {
    const saved = restored?.sessions || []
    const missingBoilerplates = initialSessions.filter(template => !saved.some(session => session.name === template.name))
    return saved.length ? [...saved, ...missingBoilerplates] : initialSessions
  })
  const [activeSession, setActiveSession] = useState('Hackathon')
  const [search, setSearch] = useState('')
  const [sessionIdeas, setSessionIdeas] = useState<Record<string, Idea[]>>(() => ({
    ...restored?.sessionIdeas,
    Hackathon: restored?.sessionIdeas.Hackathon || [],
  }))
  const [expanded, setExpanded] = useState<string[]>(['Hackathon'])
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState('')
  const restartDialog = useRef<HTMLDialogElement>(null)
  const pollingGeneration = useRef(0)
  const resetInProgress = useRef(false)
  const [ideasError, setIdeasError] = useState('')
  const [ideasLoading, setIdeasLoading] = useState(true)
  const [layout, setLayout] = useState<'horizontal' | 'grid'>('horizontal')
  const [focusedIdeaId, setFocusedIdeaId] = useState<string | null>(null)
  const ideas = sessionIdeas[activeSession] || []
  const setIdeas = (update: (current: Idea[]) => Idea[]) => setSessionIdeas(current => ({ ...current, [activeSession]: update(current[activeSession] || []) }))
  const [selectedIdea, setSelectedIdea] = useState<string | null>(null)
  const { transcript, recording, error, loaded, elapsedSeconds, startRecording, stopRecording, resetMemory, exportTranscript } = useTranscription()
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const transcriptFeedRef = useRef<HTMLDivElement>(null)
  const discussedCardRef = useRef<HTMLElement | null>(null)
  const transitioning = recording === 'connecting' || recording === 'saving' || restarting
  const appShellRef = useRef<HTMLDivElement>(null)
  const [transcriptWidth, setTranscriptWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('transcript_width')
      if (saved) {
        const parsed = Number(saved)
        if (!Number.isNaN(parsed) && parsed >= 260 && parsed <= 800) {
          return parsed
        }
      }
    } catch {}
    return 314
  })
  const [isDraggingTranscript, setIsDraggingTranscript] = useState(false)
  const transcriptWidthRef = useRef(transcriptWidth)

  useEffect(() => {
    transcriptWidthRef.current = transcriptWidth
  }, [transcriptWidth])

  useEffect(() => {
    if (!isDraggingTranscript) return

    document.body.classList.add('is-resizing')

    const handlePointerMove = (event: PointerEvent) => {
      const containerRight = appShellRef.current
        ? appShellRef.current.getBoundingClientRect().right
        : window.innerWidth
      const rawWidth = containerRight - event.clientX
      const { minWidth, maxWidth } = getTranscriptWidthBounds()
      const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(rawWidth)))
      transcriptWidthRef.current = clamped
      if (appShellRef.current) {
        appShellRef.current.style.setProperty('--transcript-width', `${clamped}px`)
      }
    }

    const handlePointerUp = () => {
      setIsDraggingTranscript(false)
      const finalWidth = transcriptWidthRef.current
      setTranscriptWidth(finalWidth)
      try {
        localStorage.setItem('transcript_width', String(finalWidth))
      } catch {}
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isDraggingTranscript])

  useEffect(() => {
    const handleResize = () => {
      const { minWidth, maxWidth } = getTranscriptWidthBounds()
      setTranscriptWidth(current => {
        const clamped = Math.max(minWidth, Math.min(maxWidth, current))
        if (clamped !== current) {
          transcriptWidthRef.current = clamped
          if (appShellRef.current) {
            appShellRef.current.style.setProperty('--transcript-width', `${clamped}px`)
          }
          try {
            localStorage.setItem('transcript_width', String(clamped))
          } catch {}
          return clamped
        }
        return current
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  function handleResizerDoubleClick() {
    const defaultWidth = 314
    const { minWidth, maxWidth } = getTranscriptWidthBounds()
    const resetWidth = Math.max(minWidth, Math.min(maxWidth, defaultWidth))
    setTranscriptWidth(resetWidth)
    transcriptWidthRef.current = resetWidth
    if (appShellRef.current) {
      appShellRef.current.style.setProperty('--transcript-width', `${resetWidth}px`)
    }
    try {
      localStorage.setItem('transcript_width', String(resetWidth))
    } catch {}
  }

  function handleResizerKeyDown(event: React.KeyboardEvent) {
    const { minWidth, maxWidth } = getTranscriptWidthBounds()
    const step = event.shiftKey ? 40 : 16
    let nextWidth = transcriptWidth

    if (event.key === 'ArrowLeft') {
      nextWidth = Math.min(maxWidth, transcriptWidth + step)
    } else if (event.key === 'ArrowRight') {
      nextWidth = Math.max(minWidth, transcriptWidth - step)
    } else if (event.key === 'Home') {
      nextWidth = minWidth
    } else if (event.key === 'End') {
      nextWidth = maxWidth
    } else if (event.key === 'Enter') {
      nextWidth = 314
    } else {
      return
    }

    event.preventDefault()
    setTranscriptWidth(nextWidth)
    transcriptWidthRef.current = nextWidth
    if (appShellRef.current) {
      appShellRef.current.style.setProperty('--transcript-width', `${nextWidth}px`)
    }
    try {
      localStorage.setItem('transcript_width', String(nextWidth))
    } catch {}
  }

  useEffect(() => {
    try {
      localStorage.setItem(workspaceKey, JSON.stringify({ sessions, sessionIdeas }))
      // Report the result of synchronizing with browser storage.
      // oxlint-disable-next-line react/set-state-in-effect
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [sessions, sessionIdeas])

  useLayoutEffect(() => {
    const feed = transcriptFeedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [transcript, transcriptOpen, recording])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let refreshDelay = __IDEA_POLL_INTERVAL_MS__
    async function refresh() {
      if (resetInProgress.current) { timer = setTimeout(refresh, __IDEA_POLL_INTERVAL_MS__); return }
      const generation = pollingGeneration.current
      try {
        const response = await fetch('/api/pubsub/idea-updates.jsonl', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Could not load generated ideas.')
        const data = foldIdeaUpdates(await response.text())
        if (controller.signal.aborted || generation !== pollingGeneration.current) return
        setSessionIdeas(current => ({ ...current, Hackathon: mergeGeneratedIdeas(current.Hackathon || [], data) }))
        const focused = data.find(idea => idea.is_currently_discussed)
        setFocusedIdeaId(focused ? `engine-${focused.id}` : null)
        setIdeasError('')
        refreshDelay = __IDEA_POLL_INTERVAL_MS__
      } catch {
        if (!controller.signal.aborted && generation === pollingGeneration.current) {
          refreshDelay = Math.min(refreshDelay * 2, 30000)
          setFocusedIdeaId(null)
          setIdeasError('Showing saved ideas. Live updates are unavailable; retrying…')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIdeasLoading(false)
          timer = setTimeout(refresh, refreshDelay)
        }
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [])

  const query = search.trim().toLowerCase()
  const matchesIdea = (idea: Idea) => `${idea.title} ${idea.summary}`.toLowerCase().includes(query)
  const visibleSessions = sessions.filter(session => session.name.toLowerCase().includes(query) || (sessionIdeas[session.name] || []).some(matchesIdea))
  const currentIdea = ideas.find(idea => idea.id === selectedIdea)

  const visibleFocusedIdeaId = activeSession === 'Hackathon' && !currentIdea
    ? ideas.find(idea => idea.id === focusedIdeaId)?.id
    : undefined

  useLayoutEffect(() => {
    if (!visibleFocusedIdeaId) return
    discussedCardRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [visibleFocusedIdeaId, layout])

  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const seconds = String(elapsedSeconds % 60).padStart(2, '0')

  function downloadMemory() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sessions, sessionIdeas, transcript }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'brainstorm-memory.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function restartBrainstorm() {
    resetInProgress.current = true
    setRestarting(true)
    setRestartError('')
    pollingGeneration.current += 1
    try {
      await resetMemory()
      setSessionIdeas(current => ({ ...current, Hackathon: [] }))
      setActiveSession('Hackathon')
      setSelectedIdea(null)
      setFocusedIdeaId(null)
      restartDialog.current?.close()
      await startRecording()
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : 'Could not restart. Please try again.')
    } finally {
      pollingGeneration.current += 1
      resetInProgress.current = false
      setRestarting(false)
    }
  }

  function createSession() {
    const name = `New brainstorm ${sessions.length}`
    setSessions((current) => [{ name, date: 'Just now', ideas: 0 }, ...current])
    setActiveSession(name)
    setExpanded(current => [...current, name])
    setSearch('')
    setSelectedIdea(null)
  }

  function addIdea() {
    const nextIdea: Idea = {
      id: crypto.randomUUID(),
      title: 'A new idea taking shape',
      summary: 'A fresh thought from the room. Add context as the conversation unfolds.',
      tag: 'Just added',
      votes: 0,
      pattern: 'orbit',
    }
    setIdeas((current) => [...current, nextIdea])
    setSelectedIdea(nextIdea.id)
  }

  function openSession(name: string, ideaId: string | null = null) {
    setActiveSession(name)
    setSelectedIdea(ideaId)
    setExpanded(current => current.includes(name) ? current : [...current, name])
  }

  const collaboratorActions = (
    <div className="collaborator-actions">
      {!currentIdea && <div className="layout-picker" role="group" aria-label="Card layout">
        <button type="button" aria-label="Horizontal layout" title="Horizontal layout" aria-pressed={layout === 'horizontal'} onClick={() => setLayout('horizontal')}><Columns3 size={16} /></button>
        <button type="button" aria-label="Grid layout" title="Grid layout" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={16} /></button>
      </div>}
      <button type="button" className="icon-button transcript-toggle" onClick={() => setTranscriptOpen(true)} aria-label="Open transcript"><AudioLines size={16} /></button>
    </div>
  )

  return (
    <div
      ref={appShellRef}
      className="app-shell"
      style={{ '--transcript-width': `${transcriptWidth}px` } as React.CSSProperties}
    >
      <dialog ref={restartDialog} className="restart-dialog" aria-labelledby="restart-title" onCancel={event => { if (restarting) event.preventDefault() }}>
        <button type="button" className="icon-button restart-dialog-close" aria-label="Cancel restart" disabled={restarting} onClick={() => restartDialog.current?.close()}><X size={18} /></button>
        <h2 id="restart-title">Restart brainstorm?</h2>
        <p>Are you sure you want to clear the memory and start over?</p>
        <p>This clears the Hackathon ideas and the transcript. Other brainstorms are kept. Download your memory first if you want to keep a copy.</p>
        {restartError && <p role="alert">{restartError}</p>}
        <div className="restart-actions">
          <button className="record-control primary-control" disabled={restarting} onClick={() => void restartBrainstorm()}>{restarting ? 'Restarting…' : 'Clear memory and restart'}</button>
          <button className="outline-button" disabled={restarting} onClick={downloadMemory}><Download size={14} /> Download memory</button>
        </div>
      </dialog>
      <aside className="session-sidebar" aria-label="Brainstorming sessions">
        <div className="wordmark">brainy storm</div>
        <button type="button" className="new-session-button" onClick={createSession} aria-label="New brainstorm">
          <Plus size={16} />
          <span>New brainstorm</span>
          <span className="shortcut"><Command size={11} /> K</span>
        </button>

        <label className="session-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search brainstorms & ideas"
            aria-label="Search brainstorms and ideas"
          />
          <span className="search-shortcut">⌘ /</span>
        </label>

        <nav className="session-list-area" aria-label="Brainstorms and ideas">
          <div className="session-list">
            {visibleSessions.map(session => {
              const open = Boolean(query) || expanded.includes(session.name)
              const children = (sessionIdeas[session.name] || []).filter(idea => !query || session.name.toLowerCase().includes(query) || matchesIdea(idea))
              return <div className="brainstorm-folder" key={session.name}>
                <div className={`folder-row ${activeSession === session.name && !currentIdea ? 'active' : ''}`}>
                  <button type="button" className="folder-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${session.name}`} aria-expanded={open} onClick={() => setExpanded(current => current.includes(session.name) ? current.filter(name => name !== session.name) : [...current, session.name])}>
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <button type="button" className="session-item" onClick={() => openSession(session.name)}>
                    {open ? <FolderOpen size={15} /> : <Folder size={15} />}<span className="session-name">{session.name}</span>
                  </button>
                </div>
                {open && <div className="folder-ideas">
                  {children.map(idea => <button key={idea.id} type="button" className={`idea-nav-item ${activeSession === session.name && selectedIdea === idea.id ? 'active' : ''}`} aria-current={activeSession === session.name && selectedIdea === idea.id ? 'page' : undefined} title={idea.title} onClick={() => openSession(session.name, idea.id)}><AbstractSymbol /><span>{idea.title || 'Untitled idea'}</span></button>)}
                  {children.length === 0 && <p className="empty-folder">No ideas yet</p>}
                </div>}
              </div>
            })}
            {visibleSessions.length === 0 && <p className="empty-search">No brainstorms or ideas found</p>}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <button type="button" className="profile-row" aria-label="Leonarda Lovrić profile">
            <span className="profile-avatar">LL</span>
            <span className="profile-copy"><strong>Leonarda Lovrić</strong><small>Personal workspace</small></span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      <main className="main-column">
        <section className={`board-scroll ${!currentIdea && layout === 'horizontal' ? 'horizontal-board' : ''}`}>
          <div className="board-content">
            {(ideasLoading || ideasError) && <InfoBanner key={ideasError || 'ideas-loading'} message={ideasError || 'Loading ideas…'} loading />}
            {currentIdea ? <article className="idea-page">
              <div className="idea-page-banner"><BrandShape variant={ideas.findIndex(idea => idea.id === currentIdea.id) % 6} /></div>
              <div className="idea-page-toolbar"><button type="button" className="idea-back-button" onClick={() => setSelectedIdea(null)}>← Back to {activeSession}</button>{collaboratorActions}</div>
              <EditableIdea key={currentIdea.id} idea={currentIdea} storageError={storageError} onChange={fields => setIdeas(current => current.map(idea => idea.id === currentIdea.id ? { ...idea, ...fields, locallyEdited: true } : idea))} />
            </article> : <>
            <div className="board-heading-row">
              <div>
                <h1>{activeSession}</h1>
              </div>
              {collaboratorActions}
            </div>

            {ideas.length > 0 ? (
              <div className={`idea-grid ${layout === 'horizontal' ? 'idea-rail' : ''}`} tabIndex={0} role="region" aria-label="Ideas">
                {ideas.map((idea, index) => (
                  <article
                    key={idea.id}
                    ref={visibleFocusedIdeaId === idea.id ? discussedCardRef : undefined}
                    className={`idea-card ${activeSession === 'Hackathon' && focusedIdeaId === idea.id ? 'discussion-focus' : ''}`}
                    onClick={() => setSelectedIdea(idea.id)}
                  >
                    <div className={`idea-art art-${idea.pattern}`}>
                      <BrandShape variant={index % 6} />
                      {idea.thumbnail && <img className="idea-thumbnail" src={idea.thumbnail} alt="" onError={event => { event.currentTarget.style.display = 'none' }} />}
                    </div>
                    <div className="idea-card-body">
                      <div className="idea-card-topline">{activeSession === 'Hackathon' && focusedIdeaId === idea.id && <span className="discussion-label">Discussing now</span>}<span className="idea-tag">{idea.tag}</span><button className="icon-button small" type="button" aria-label="Idea options"><MoreHorizontal size={17} /></button></div>
                      <h3><button type="button" className="idea-title-button" onClick={() => setSelectedIdea(idea.id)}>{idea.title || 'Untitled idea'}</button></h3>
                      <p>{idea.summary}</p>
                      <div className="idea-card-footer">
                        <button type="button" className="vote-button" aria-label={`Upvote, ${idea.votes} votes`} onClick={(event) => { event.stopPropagation(); setIdeas((current) => current.map((entry) => entry.id === idea.id ? { ...entry, votes: entry.votes + 1 } : entry)) }}>
                          <ArrowDown className="vote-arrow" size={14} /><span>{idea.votes}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                <button type="button" className="add-idea-card" onClick={addIdea}>
                  <span className="add-idea-icon"><AbstractSymbol /></span>
                  <strong>Capture an idea</strong>
                  <span>Or let one emerge from the conversation</span>
                </button>
              </div>
            ) : (
              <div className="empty-board">
                <span className="empty-board-icon"><AbstractSymbol /></span>
                <strong>No ideas yet</strong>
                <span>Start talking and ideas will find a home here.</span>
                <button className="outline-button" type="button" onClick={addIdea}><Plus size={15} /> Add an idea</button>
              </div>
            )}

            </>}
          </div>
        </section>

        <footer className="recording-dock">
          <RecordingShape active={recording === 'recording'} />
          <span className="recording-time"><Clock3 size={14} /> {minutes}:{seconds}</span>
          <button
            type="button"
            className="record-control primary-control"
            disabled={transitioning}
            aria-busy={transitioning}
            onClick={() => recording === 'recording' ? stopRecording(true) : void startRecording()}
          >
            {recording === 'recording' || recording === 'saving' ? <Pause size={13} /> : <Play size={14} fill="currentColor" />}
            <span>{recording === 'connecting' ? 'Starting…' : recording === 'saving' ? 'Pausing…' : recording === 'recording' ? 'Pause' : recording === 'paused' ? 'Resume' : 'Start'}</span>
          </button>
          <button type="button" className="record-control restart-control" disabled={transitioning} onClick={() => { setRestartError(''); restartDialog.current?.showModal() }}><RotateCcw size={14} /><span>Restart</span></button>
        </footer>
      </main>

      <aside className={`transcript-sidebar ${transcriptOpen ? 'mobile-open' : ''}`} aria-label="Live transcript">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize transcript panel"
          title="Drag to resize transcript (double-click to reset)"
          aria-valuenow={transcriptWidth}
          aria-valuemin={260}
          aria-valuemax={800}
          tabIndex={0}
          className={`transcript-resizer ${isDraggingTranscript ? 'is-dragging' : ''}`}
          onPointerDown={event => {
            if (event.button === 0) {
              setIsDraggingTranscript(true)
            }
          }}
          onDoubleClick={handleResizerDoubleClick}
          onKeyDown={handleResizerKeyDown}
        />
        <div className="transcript-header">
          <div><div className="transcript-title-row"><h2>Transcript</h2><button type="button" className="icon-button small mobile-close" onClick={() => setTranscriptOpen(false)} aria-label="Close transcript"><X size={16} /></button></div></div>
          <details className="transcript-options" onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
          }} onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary className="icon-button small" aria-label="Transcript options"><MoreHorizontal size={18} /></summary>
            <div className="transcript-options-menu">
              <button type="button" className="transcript-export" onClick={event => {
                exportTranscript()
                const menu = event.currentTarget.closest('details')
                if (menu) {
                  menu.open = false
                  menu.querySelector('summary')?.focus()
                }
              }}><FileText size={14} /><span>Export transcript</span></button>
            </div>
          </details>
        </div>
        <div className="transcript-feed" ref={transcriptFeedRef} aria-live="polite">
          {error && <InfoBanner key={error} message={error} role="alert" />}
          {!loaded && !error && <InfoBanner message="Loading existing transcript…" loading />}
          {loaded && transcript.length === 0 && <p>Start recording to capture your conversation.</p>}
          <div className="transcript-date"><span />TODAY<span /></div>
          {transcript && <article className={`transcript-line ${recording === 'recording' ? 'currently-speaking' : ''}`}>
            <div className="transcript-line-content"><p>{transcript}</p></div>
          </article>}
          {recording === 'recording' && <div className="transcript-capture"><span className="capture-avatar">···</span><span>Listening for the next thought</span><span className="capture-pulse" /></div>}
        </div>
      </aside>
      {transcriptOpen && <button type="button" className="mobile-scrim" onClick={() => setTranscriptOpen(false)} aria-label="Close transcript panel" />}
    </div>
  )
}

export default App
