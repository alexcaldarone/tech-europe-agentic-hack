export type CompetitorItem = {
  name: string
  summary?: string
  differentiator?: string
  idea?: string | null
  yearOfFounding?: string | null
  shortBio?: string | null
  howWeDiffer?: string | null
}

export type CompetitorEnrichment = {
  summary?: string | null
  competitors: CompetitorItem[]
  market_landscape?: string
  our_positioning?: string
  groundingSources?: string[]
  generated_at?: number
}

export type ProConItem = {
  point: string
  category: string
  severity_or_impact: 'High' | 'Medium' | 'Low' | string
  source_context?: string
}

export type ProsConsEnrichment = {
  summary?: string | null
  pros: (ProConItem | string)[]
  cons: (ProConItem | string)[]
  key_risks?: string[]
  assumptions?: string[]
  generated_at?: number
}

export type GeneratedIdea = {
  id: string | number
  title: string
  summary: string
  short_summary?: string | null
  thumbnail?: string | null
  is_currently_discussed?: boolean
  transcript?: string | null
  raw_body?: string | null
  proponents?: string[]
  opponents?: string[]
  competitors?: CompetitorEnrichment | null
  pros_cons?: ProsConsEnrichment | null
  status?: string
  metadata?: Record<string, any>
  conclusion?: string | null
  [key: string]: any
}

export type Idea = GeneratedIdea & {
  id: string
  originalId?: string
  title: string
  summary: string
  tag: string
  votes: number
  pattern: string
  thumbnail?: string | null
  locallyEdited?: boolean
  rawIdea?: any
}
// One idea-updates.jsonl line: a partial idea from the engine or enrichment, keyed by id.
type IdeaUpdateMessage = { id: string; 'short-summary'?: string; 'is-currently-discussed'?: boolean; [field: string]: unknown }

export function foldIdeaUpdates(topic: string): GeneratedIdea[] {
  const ideas = new Map<string, GeneratedIdea>()
  // A publisher may be mid-write: only complete lines are messages.
  for (const line of topic.slice(0, topic.lastIndexOf('\n') + 1).split('\n')) {
    if (!line.trim()) continue
    const { id, 'short-summary': summary, 'is-currently-discussed': discussed, ...fields } = JSON.parse(line) as IdeaUpdateMessage
    ideas.set(id, {
      ...(ideas.get(id) || { id, title: '', summary: '' }),
      ...fields,
      ...(summary !== undefined && { summary }),
      ...(discussed !== undefined && { is_currently_discussed: discussed }),
    })
  }
  return [...ideas.values()]
}

export type Session = { name: string; date: string; ideas: number }
export type Workspace = { sessions: Session[]; sessionIdeas: Record<string, Idea[]> }
export const workspaceKey = 'brainy-storm.workspace.v1'

export function readWorkspace(raw: string | null): Workspace | null {
  try {
    const data = JSON.parse(raw || 'null')
    if (!data || !Array.isArray(data.sessions) || !data.sessionIdeas || typeof data.sessionIdeas !== 'object' || Array.isArray(data.sessionIdeas)) return null
    if (!data.sessions.every((s: Session) => s && typeof s.name === 'string' && typeof s.date === 'string' && typeof s.ideas === 'number')) return null
    if (!Object.values(data.sessionIdeas).every(ideas => Array.isArray(ideas) && ideas.every(idea => idea && ['id', 'title', 'summary', 'tag', 'pattern'].every(key => typeof idea[key] === 'string') && typeof idea.votes === 'number' && (idea.thumbnail == null || typeof idea.thumbnail === 'string')))) return null
    return data as Workspace
  } catch { return null }
}

export function mergeGeneratedIdeas(current: Idea[], incoming: GeneratedIdea[]): Idea[] {
  const merged: Idea[] = incoming.map((idea, index) => {
    const previous = current.find(entry => entry.id === `engine-${idea.id}` || entry.id === String(idea.id))
    return {
      ...idea,
      rawIdea: idea,
      id: `engine-${idea.id}`,
      originalId: String(idea.id),
      tag: previous?.tag || 'From the conversation',
      votes: previous?.votes || 0,
      pattern: previous?.pattern || ['orbit', 'grid', 'signal'][index % 3],
      thumbnail: idea.thumbnail ?? previous?.thumbnail,
      ...(previous?.locallyEdited ? { title: previous.title, summary: previous.summary, tag: previous.tag, locallyEdited: true } : {}),
    }
  })
  const updates = new Map(merged.map(idea => [idea.id, idea]))
  const existingIds = new Set(current.map(idea => idea.id))
  return [
    ...current.filter(idea => updates.has(idea.id) || !idea.id.startsWith('engine-') || idea.locallyEdited).map(idea => updates.get(idea.id) || idea),
    ...merged.filter(idea => !existingIds.has(idea.id)),
  ]
}
