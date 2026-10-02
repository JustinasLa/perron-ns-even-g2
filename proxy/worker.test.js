import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './worker.js'

const env = { NS_API_KEY: 'test-key' }
const request = (path = '/v3/trips', method = 'GET') => new Request('https://proxy.test' + path, { method })

afterEach(() => vi.unstubAllGlobals())

describe('NS proxy', () => {
  it('answers CORS preflight without accessing NS', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await worker.fetch(request('/', 'OPTIONS'), env)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'DELETE', 'HEAD'])('rejects %s requests', async (method) => {
    const response = await worker.fetch(request('/', method), env)
    expect(response.status).toBe(405)
    expect(await response.text()).toBe('Method Not Allowed')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it.each(['/privacy', '/privacy/'])('serves the privacy policy at %s', async (path) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await worker.fetch(request(path), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    const html = await response.text()
    expect(html).toContain('<title>Privacy Policy')
    expect(html).toContain('Last updated: 3 October 2026')
    expect(html).toContain("Even Hub's host-backed storage")
    expect(html).toContain('<strong>Language preference</strong>')
    expect(html).toMatch(/Station autocomplete\s+runs locally against that list; the text you type is not sent to the proxy or NS\./)
    for (const field of ['getLocalStorage', 'setLocalStorage', 'station', 'fromStation', 'toStation', 'dateTime', 'searchForArrival', 'lang', 'train']) {
      expect(html).toContain('<code>' + field + '</code>')
    }
    expect(html).toContain('Departure boards and disruptions:')
    expect(html).toContain('Journey planning:')
    expect(html).toContain('Train stop lists:')
    expect(html).toMatch(/platform retention and deletion are\s+controlled by Even Hub\./)
    expect(html).toMatch(/Retention of\s+requests or metadata processed by Cloudflare and NS is governed by those\s+providers' policies\./)
    expect(html).toContain('justinas.launikonis@student.nhlstenden.com')
    expect(html).not.toContain('browser <code>localStorage</code>')
    expect(html).not.toContain('transiently')
    expect(html).not.toContain('Removing the app')
    expect(html).not.toContain('justinas.launikonis@gmail.com')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([200, 429, 503])('forwards the path, query, key, body, and upstream status %i', async (status) => {
    const payload = JSON.stringify({ status })
    const fetchMock = vi.fn().mockResolvedValue(new Response(payload, { status }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await worker.fetch(request('/v3/trips?fromStation=UT&toStation=ASD'), env)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      'https://gateway.apiportal.ns.nl/reisinformatie-api/api/v3/trips?fromStation=UT&toStation=ASD',
      { headers: { 'Ocp-Apim-Subscription-Key': 'test-key' } },
    )
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(payload)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns a readable 502 when the upstream network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const response = await worker.fetch(request(), env)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Upstream fetch failed', detail: 'Error: offline' })
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns a readable 502 when the upstream body stream fails', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"payload":'))
      },
      pull(controller) {
        controller.error(new Error('body stream failed'))
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream))
    vi.stubGlobal('fetch', fetchMock)
    const response = await worker.fetch(request(), env)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Upstream fetch failed', detail: 'Error: body stream failed' })
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })
})
