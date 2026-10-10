import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkspace, mergeGeneratedIdeas, foldIdeaUpdates } from './ideaWorkspace.ts'

const idea = { id: 'engine-1', title: 'My title', summary: 'My notes\nSecond paragraph', tag: 'Next steps', votes: 3, pattern: 'orbit', thumbnail: '/ideas/1/artifacts/thumbnail.svg', locallyEdited: true }

test('polling preserves edits and votes while adding incoming ideas', () => {
  const result = mergeGeneratedIdeas([idea], [{ id: 1, title: 'Server title', summary: 'Server summary' }, { id: 2, title: 'New idea', summary: 'New content' }])
  assert.equal(result[0].title, idea.title)
  assert.equal(result[0].summary, idea.summary)
  assert.equal(result[0].tag, idea.tag)
  assert.equal(result[0].thumbnail, idea.thumbnail)
  assert.equal(result[0].votes, 3)
  assert.equal(result[1].title, 'New idea')
})

test('server refresh does not erase edited or manually created pages', () => {
  const manual = { ...idea, id: 'manual-1', locallyEdited: undefined }
  assert.deepEqual(mergeGeneratedIdeas([idea, manual], []), [idea, manual])
})

test('unedited generated ideas receive server updates', () => {
  const result = mergeGeneratedIdeas([{ ...idea, locallyEdited: false }], [{ id: 1, title: 'Updated', summary: 'Updated summary' }])
  assert.equal(result[0].title, 'Updated')
  assert.equal(result[0].votes, 3)
})

test('workspace round-trip retains multiline edits and manual sessions', () => {
  const workspace = { sessions: [{ name: 'New brainstorm', date: 'Just now', ideas: 1 }], sessionIdeas: { 'New brainstorm': [idea] } }
  assert.deepEqual(readWorkspace(JSON.stringify(workspace)), workspace)
})

test('malformed storage safely falls back to an empty workspace', () => {
  for (const raw of [null, '{', '{}', '{"sessions":[null],"sessionIdeas":{}}', '{"sessions":[],"sessionIdeas":{"x":[{}]}}']) assert.equal(readWorkspace(raw), null)
})

test('new ideas append after manual cards and polling never reorders existing cards', () => {
  const manual = { ...idea, id: 'manual-1' }
  const incoming = [
    { id: 2, title: 'Newest', summary: '' },
    { id: 1, title: 'Original', summary: '' },
  ]
  const result = mergeGeneratedIdeas([idea, manual], incoming)
  assert.deepEqual(result.map(i => i.id), ['engine-1', 'manual-1', 'engine-2'])
  assert.deepEqual(mergeGeneratedIdeas(result, incoming).map(i => i.id), result.map(i => i.id))
})

test('idea updates fold by id in first-seen order, merging engine and enrichment fields', () => {
  const topic = [
    { id: 'idea-1', title: 'Scrape catalogs', 'short-summary': 'Scraping.', 'is-currently-discussed': true },
    { id: 'idea-1', competitors: ['Nosto'] },
    { id: 'idea-2', title: 'Partner', 'short-summary': 'License data.', 'is-currently-discussed': true },
    { id: 'idea-1', title: 'Scrape catalogs', 'short-summary': 'Scraping, but costly.', 'is-currently-discussed': false },
  ].map(message => JSON.stringify(message) + '\n').join('')
  assert.deepEqual(foldIdeaUpdates(topic), [
    { id: 'idea-1', title: 'Scrape catalogs', summary: 'Scraping, but costly.', is_currently_discussed: false, competitors: ['Nosto'] },
    { id: 'idea-2', title: 'Partner', summary: 'License data.', is_currently_discussed: true },
  ])
})

test('an empty topic or a partially written line yields no ideas', () => {
  assert.deepEqual(foldIdeaUpdates(''), [])
  assert.deepEqual(foldIdeaUpdates('{"id": "idea-1", "tit'), [])
})
