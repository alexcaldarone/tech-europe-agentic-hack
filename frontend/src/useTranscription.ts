import { useEffect, useRef, useState } from 'react'

type Status = 'stopped' | 'connecting' | 'recording' | 'paused' | 'saving'
const base = (import.meta.env.VITE_TRANSCRIBER_URL || '/api/transcriber').replace(/\/$/, '')

export function useTranscription() {
  const [transcript, setTranscript] = useState('')
  const [recording, setRecording] = useState<Status>('stopped')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const resources = useRef<{ stream?: MediaStream; context?: AudioContext; node?: AudioWorkletNode; socket?: WebSocket }>({})
  const busy = useRef(false)
  const mounted = useRef(true)
  const stopTarget = useRef<Status>('stopped')
  const stopping = useRef(false)
  const historyRequest = useRef(0)
  const readyTimer = useRef<number | undefined>(undefined)
  const completionTimer = useRef<number | undefined>(undefined)

  function clearTimers() {
    window.clearTimeout(readyTimer.current)
    window.clearTimeout(completionTimer.current)
  }

  function releaseAudio() {
    const r = resources.current
    if (r.node) { r.node.port.onmessage = null; r.node.disconnect() }
    r.stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
    if (r.context && r.context.state !== 'closed') void r.context.close().catch(() => {})
    r.node = undefined
    r.stream = undefined
    r.context = undefined
  }

  async function readTranscript(signal = AbortSignal.timeout(8000)) {
    const response = await fetch('/api/pubsub/transcript.txt', { signal, cache: 'no-store' })
    if (!response.ok) throw new Error('Could not load the persisted transcript.')
    return await response.text()
  }

  async function loadTranscript(signal?: AbortSignal) {
    const request = ++historyRequest.current
    const text = await readTranscript(signal)
    if (!mounted.current || request !== historyRequest.current) return
    // One continuous stream: the file's batch lines are joined like live captions.
    const formatted = text.split('\n').map(line => line.trim()).filter(Boolean).join(' ')
    setTranscript(current => (current === formatted ? current : formatted))
    setLoaded(true)
    setError(current => (current.startsWith('Backend unavailable:') ? '' : current))
  }

  function cleanupRecording() {
    ++historyRequest.current
    clearTimers()
    releaseAudio()
    const socket = resources.current.socket
    resources.current.socket = undefined
    if (socket?.readyState === WebSocket.OPEN && !stopping.current) socket.send(JSON.stringify({ action: 'stop' }))
    socket?.close()
  }

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void loadTranscript(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])).catch(err => {
      if (!controller.signal.aborted) setError(`Backend unavailable: ${err.message}`)
    })
    return () => {
      mounted.current = false
      controller.abort()
      cleanupRecording()
    }
  }, [])

  useEffect(() => {
    if (recording !== 'stopped') return
    const interval = window.setInterval(() => {
      if (!stopping.current) {
        void loadTranscript().catch(() => {})
      }
    }, 1000)
    return () => window.clearInterval(interval)
  }, [recording])

  useEffect(() => {
    if (recording !== 'recording') return
    const timer = window.setInterval(() => setElapsedSeconds(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording])

  function abandonConnection(message: string) {
    clearTimers()
    releaseAudio()
    const socket = resources.current.socket
    resources.current.socket = undefined
    socket?.close()
    busy.current = false
    if (mounted.current) { setError(message); setRecording('stopped') }
  }

  function stopRecording(pause = false) {
    if (stopping.current) return
    stopTarget.current = pause ? 'paused' : 'stopped'
    stopping.current = true
    releaseAudio()
    window.clearTimeout(readyTimer.current)
    const socket = resources.current.socket
    if (socket?.readyState !== WebSocket.OPEN) {
      abandonConnection('Recording disconnected; final transcript saving was not confirmed.')
      return
    }
    setRecording('saving')
    completionTimer.current = window.setTimeout(() => {
      abandonConnection('Saving was not confirmed within ten seconds. Check the transcript before recording again.')
    }, 10000)
    socket.send(JSON.stringify({ action: 'stop' }))
  }

  async function startRecording() {
    if (busy.current) return
    busy.current = true
    stopping.current = false
    setError('')
    setRecording('connecting')
    try {
      // Reload each time, including after another browser changed the room's file.
      await loadTranscript()
      if (!mounted.current) return
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires localhost or HTTPS.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return }
      resources.current.stream = stream
      const context = new AudioContext({ sampleRate: 24000 })
      resources.current.context = context
      await context.resume()
      if (!mounted.current) { releaseAudio(); return }
      if (context.sampleRate !== 24000) throw new Error('This browser does not support 24 kHz microphone audio.')
      await context.audioWorklet.addModule('/pcm-worklet.js')
      if (!mounted.current) { releaseAudio(); return }
      const node = new AudioWorkletNode(context, 'pcm-recorder')
      resources.current.node = node
      const url = new URL(`${base}/ws/transcribe`, window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      resources.current.socket = socket
      let ready = false
      let failed = false
      stream.getAudioTracks()[0].onended = () => {
        setError('Microphone disconnected. Recording stopped.')
        stopRecording()
      }
      readyTimer.current = window.setTimeout(() => {
        abandonConnection('The transcription service did not become ready. Try again.')
      }, 15000)
      node.port.onmessage = event => {
        if (ready && !stopping.current && socket.readyState === WebSocket.OPEN) {
          if (socket.bufferedAmount > 240000) {
            setError('Connection too slow to record reliably. Please retry.')
            stopRecording()
            return
          }
          socket.send(event.data)
        }
      }
      socket.onmessage = event => {
        if (!mounted.current || resources.current.socket !== socket) return
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'ready' && !stopping.current) {
            window.clearTimeout(readyTimer.current)
            ready = true
            context.createMediaStreamSource(stream).connect(node)
            node.connect(context.destination)
            setRecording('recording')
          } else if (message.type === 'transcript') {
            setTranscript(current => current ? `${current} ${message.text}` : message.text)
          } else if (message.type === 'error') {
            failed = true
            setError(message.message || 'Transcription failed.')
            stopRecording()
          }
        } catch {
          failed = true
          setError('The transcription service sent an invalid response.')
          stopRecording()
        }
      }
      socket.onerror = () => {
        if (resources.current.socket === socket) abandonConnection('Cannot connect to the transcription backend; final saving was not confirmed.')
      }
      socket.onclose = async event => {
        if (resources.current.socket !== socket) return
        clearTimers()
        releaseAudio()
        resources.current.socket = undefined
        if (!mounted.current) return
        setRecording('saving')
        if (event.code !== 1000 && !failed) setError('Recording disconnected; final transcript saving was not confirmed.')
        try {
          // The close handshake confirms that the final append has finished.
          if (event.code === 1000 && !failed) await loadTranscript()
        } catch (err) {
          setError(`Recording saved, but reload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
          busy.current = false
          if (mounted.current) setRecording(stopTarget.current)
        }
      }
    } catch (err) {
      abandonConnection(err instanceof Error ? err.message : 'Could not start recording.')
    }
  }

  async function resetMemory() {
    const socket = resources.current.socket
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Recording is still saving. Please wait and retry.')), 20000)
        socket.addEventListener('close', event => {
          window.clearTimeout(timeout)
          if (event.code === 1000) resolve()
          else reject(new Error('Recording did not finish saving. Download your memory before retrying.'))
        }, { once: true })
        stopRecording(true)
      })
    }
    const response = await fetch(`${base}/transcript/reset`, { method: 'POST', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('Could not clear memory. Please retry once the backend is available and all recordings have stopped.')
    setTranscript('')
    setElapsedSeconds(0)
    setLoaded(true)
    setRecording('stopped')
  }

  async function exportTranscript() {
    try {
      const blob = new Blob([await readTranscript()], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'transcript.txt'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not export transcript.')
    }
  }

  return { transcript, recording, error, loaded, elapsedSeconds, startRecording, stopRecording, resetMemory, exportTranscript }
}
