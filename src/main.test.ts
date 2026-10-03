import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evenHubEventFromJson, OsEventTypeList, StartUpPageCreateResult } from '@evenrealities/even_hub_sdk'
import type { LegStop, StationInfo, Trip, TripLeg } from './ns'

const mocks = vi.hoisted(() => ({
  waitForBridge: vi.fn(),
  stations: vi.fn(),
  trips: vi.fn(),
  journey: vi.fn(),
  bridge: {
    getLocalStorage: vi.fn(),
    setLocalStorage: vi.fn(),
    createStartUpPageContainer: vi.fn(),
    textContainerUpgrade: vi.fn(),
    onEvenHubEvent: vi.fn(),
    shutDownPageContainer: vi.fn(),
  },
  unsubscribe: vi.fn(),
}))

vi.mock('@evenrealities/even_hub_sdk', async (importOriginal) => ({
  ...await importOriginal<typeof import('@evenrealities/even_hub_sdk')>(),
  waitForEvenAppBridge: mocks.waitForBridge,
}))

vi.mock('./ns', () => ({ fetchStations: mocks.stations, fetchTrips: mocks.trips, fetchJourney: mocks.journey }))

type TestApp = Record<string, (...args: any[]) => any> & { state: Record<string, any> }
type BootOptions = {
  routes?: unknown
  favorites?: unknown
  lang?: string
  storage?: Record<string, string | null>
  storageError?: boolean
  startResult?: number
  missingIds?: string[]
  missingSelectors?: string[]
}

const route = { fromCode: 'UT', fromName: 'Utrecht Centraal', toCode: 'ASD', toName: 'Amsterdam Centraal' }
const amstelRoute = { ...route, toCode: 'ASA', toName: 'Amsterdam Amstel' }
const stations: StationInfo[] = [
  { code: 'UT', name: 'Utrecht Centraal', country: 'NL', synonyms: ['Utrecht CS'] },
  { code: 'ASD', name: 'Amsterdam Centraal', country: 'NL', synonyms: ['Amsterdam CS'] },
  { code: 'ASA', name: 'Amsterdam Amstel', country: 'NL', synonyms: ['Amstel'] },
  { code: 'AMS', name: 'Amsterdam Airport', country: 'DE', synonyms: [] },
  { code: 'BER', name: 'Berlin', country: 'DE', synonyms: ['Amsterdam connection'] },
  { code: 'NAM', name: 'New Amsterdam', country: '', synonyms: [] },
  { code: 'AMS2', name: 'Ams Two', country: 'NL', synonyms: [] },
  { code: 'AMS3', name: 'Ams Three', country: 'NL', synonyms: [] },
  { code: 'AMS4', name: 'Ams Four', country: 'NL', synonyms: [] },
  { code: 'AMS5', name: 'Ams Five', country: 'NL', synonyms: [] },
  { code: 'ED', name: 'Ede-Wageningen', country: 'NL', synonyms: [] },
  { code: 'EDC', name: 'Ede Centrum', country: 'NL', synonyms: [] },
  { code: 'BGN', name: 'Bergen op Zoom', country: 'NL', synonyms: [] },
]

function stop(name: string, overrides: Partial<LegStop> = {}): LegStop {
  return { name, arrival: '2026-10-02T10:30:00Z', departure: '2026-10-02T10:31:00Z', arrivalDelayMin: 0, departureDelayMin: 0, track: '2', cancelled: false, ...overrides }
}

function leg(overrides: Partial<TripLeg> = {}): TripLeg {
  return {
    service: 'IC 123', mode: 'TRAIN', category: 'IC', displayName: 'Intercity', operator: 'NS', trainNumber: '123', direction: 'Amsterdam Centraal',
    origin: route.fromName, originTrack: '5', destination: route.toName, destinationTrack: '7',
    departure: '2026-10-02T10:20:00Z', departureDelayMin: 2, arrival: '2026-10-02T10:50:00Z', arrivalDelayMin: 3,
    durationMin: 30, crowd: 'LOW', intermediateStops: 1, stops: [stop(route.fromName), stop('Amsterdam Amstel'), stop(route.toName)],
    exitSide: 'LEFT', walkToNextMin: 3, cancelled: false, ...overrides,
  }
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return { departure: '2026-10-02T10:20:00Z', arrival: '2026-10-02T10:50:00Z', durationMin: 30, transfers: 0, status: 'NORMAL', cancelled: false, cancellationReason: '', crowd: 'LOW', legs: [leg()], ...overrides }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let api: TestApp
let eventHandler: (event: any) => void
const listeners: { target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; options?: any }[] = []

async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  expect(found, selector).not.toBeNull()
  return found!
}

function click(selector: string) {
  element(selector).click()
}

function input(selector: string, value: string, code?: string) {
  const el = element<HTMLInputElement>(selector)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  if (code) el.dataset.code = code
  return el
}

function key(selector: string, value: string) {
  element(selector).dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
}

function gesture(type: number, system = false) {
  eventHandler(system ? { sysEvent: { eventType: type } } : { textEvent: { eventType: type } })
}

function lens(): string {
  const calls = mocks.bridge.textContainerUpgrade.mock.calls
  return calls[calls.length - 1][0].content
}

async function boot(options: BootOptions = {}) {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  const stored: Record<string, string | null> = {
    'perron-ns.routes.v1': options.routes === undefined ? null : JSON.stringify(options.routes),
    'perron-ns.favorites.v1': options.favorites === undefined ? null : JSON.stringify(options.favorites),
    'perron-ns.lang.v1': options.lang ?? null,
    ...options.storage,
  }
  mocks.bridge.getLocalStorage.mockImplementation(async (name: string) => {
    if (options.storageError) throw new Error('storage unavailable')
    return stored[name]
  })
  mocks.bridge.createStartUpPageContainer.mockResolvedValue(options.startResult ?? 0)
  if (options.missingIds) {
    const original = document.getElementById.bind(document)
    vi.spyOn(document, 'getElementById').mockImplementation((id) => options.missingIds!.includes(id) ? null : original(id))
  }
  if (options.missingSelectors) {
    const original = Element.prototype.querySelector
    vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (this: Element, selector: string) {
      return options.missingSelectors!.includes(selector) ? null : original.call(this, selector)
    })
  }
  const module = await import('./main') as unknown as { testApp: TestApp }
  api = module.testApp
  await flush()
  return api
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-02T10:15:00Z'))
  vi.clearAllMocks()
  mocks.waitForBridge.mockResolvedValue(mocks.bridge)
  mocks.stations.mockResolvedValue(stations)
  mocks.trips.mockResolvedValue([trip()])
  mocks.journey.mockResolvedValue([])
  mocks.bridge.setLocalStorage.mockResolvedValue(undefined)
  mocks.bridge.textContainerUpgrade.mockResolvedValue(true)
  mocks.bridge.shutDownPageContainer.mockResolvedValue(true)
  mocks.bridge.onEvenHubEvent.mockImplementation((handler) => { eventHandler = handler; return mocks.unsubscribe })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: any, options?: any) => {
      listeners.push({ target, type, listener, options })
      original(type, listener, options)
    })
  }
})

afterEach(async () => {
  window.dispatchEvent(new Event('beforeunload'))
  await flush()
  for (const registration of listeners.splice(0)) {
    registration.target.removeEventListener(registration.type, registration.listener, registration.options)
  }
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('startup and persistence', () => {
  it('starts the SDK page and renders the clock and empty planner', async () => {
    await boot()
    expect(mocks.waitForBridge).toHaveBeenCalledOnce()
    expect(mocks.bridge.createStartUpPageContainer.mock.calls[0][0]).toMatchObject({ containerTotalNum: 1, textObject: [{ containerID: 1, width: 576, height: 288, isEventCapture: 1 }] })
    expect(lens()).toContain('Please set a route')
    expect(element('#saved').textContent).toContain('no recently planned journeys')
    expect(element('#fav-list').textContent).toContain('Save favorite locations')
    expect(api.tripOpts()).toEqual({ lang: 'en' })
    const count = mocks.bridge.textContainerUpgrade.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(mocks.bridge.textContainerUpgrade.mock.calls.length).toBe(count + 1)
  })

  it.each([{}, 'bad', null])('rejects invalid stored collections: %j', async (value) => {
    await boot({ routes: value, favorites: value, lang: 'invalid' })
    expect(api.state.savedRoutes).toEqual([])
    expect(api.state.favorites).toEqual([])
  })

  it('recovers from corrupt JSON and storage errors and reports SDK startup failures', async () => {
    await boot({ storage: { 'perron-ns.routes.v1': '{', 'perron-ns.favorites.v1': '{' }, startResult: 5 })
    expect(api.state.savedRoutes).toEqual([])
    expect(api.state.favorites).toEqual([])
    expect(console.error).toHaveBeenCalledWith('createStartUpPageContainer failed:', 5)
  })

  it('recovers when storage and station loading fail', async () => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot({ storageError: true })
    expect(console.error).toHaveBeenCalledWith('loadLang failed:', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('station list load failed:', expect.any(Error))
    expect(api.state.savedRoutes).toEqual([])
    click('#plan')
    click('#fav-add')
    expect(element('#results').textContent).toBe('Loading stations…')
  })

  it('normalizes legacy favorites and loads the stored language', async () => {
    await boot({ lang: 'nl', routes: [route], favorites: [
      { code: 'UT', name: 'Utrecht Centraal' },
      { code: 'ASD', name: 'Amsterdam', label: '', icon: 'home' },
      { code: 'BER', name: 'Berlin', label: null, icon: 'work' },
      { code: 'X', name: 'Other', label: 'Label', icon: 'invalid' },
    ] })
    expect(api.tripOpts()).toEqual({ lang: 'nl' })
    expect(api.state.favorites.map((f: any) => [f.label, f.icon])).toEqual([['Utrecht Centraal', 'default'], ['', 'home'], ['Berlin', 'work'], ['Label', 'default']])
    expect(lens()).toContain('Utrecht Centraal to Amsterdam Centraal')
  })

  it('retains valid routes from mixed malformed stored entries', async () => {
    const anotherRoute = { ...route, toCode: 'ASA', toName: 'Amsterdam Amstel' }
    const invalidRoutes = ['fromCode', 'fromName', 'toCode', 'toName'].flatMap(field =>
      [null, 42, '', '  '].map(value => ({ ...route, [field]: value })),
    )
    await boot({ routes: [null, false, 7, 'bad', [], {}, route, ...invalidRoutes, anotherRoute] })
    expect(api.state.savedRoutes).toEqual([route, anotherRoute])
    expect(element('#saved').querySelectorAll('.chip')).toHaveLength(2)
    expect(lens()).toContain('Utrecht Centraal to Amsterdam Amstel')
    click('#saved .del')
    api.addRoute(route)
    await flush()
    expect(api.state.savedRoutes).toEqual([route, anotherRoute])
    expect(JSON.parse(mocks.bridge.setLocalStorage.mock.calls.at(-1)![1])).toEqual([route, anotherRoute])
  })

  it('deduplicates loaded routes in stored order and caps valid history at eight', async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ ...route, toCode: 'T' + i, toName: 'Target ' + i }))
    await boot({ routes: [null, history[0], history[0], ...history.slice(1)] })
    expect(api.state.savedRoutes).toEqual(history.slice(0, 8))
    expect(element('#saved').querySelectorAll('.chip')).toHaveLength(8)
  })

  it('retains editable favorites while normalizing malformed entries and duplicates', async () => {
    const validFavorites = [
      { code: 'UT', name: 'Utrecht Centraal' },
      { code: 'ASD', name: 'Amsterdam Centraal', label: 42, icon: 42 },
      { code: 'ASA', name: 'Amsterdam Amstel', label: {}, icon: true },
      { code: 'BER', name: 'Berlin', label: true, icon: {} },
      { code: 'AMS', name: 'Amsterdam Airport', label: 'Airport', icon: 'home' },
    ]
    const invalidFavorites = ['code', 'name'].flatMap(field =>
      [null, 42, '', '  '].map(value => ({ code: 'UT', name: 'Utrecht Centraal', [field]: value })),
    )
    await boot({ favorites: [null, false, 7, 'bad', [], {}, validFavorites[0], ...invalidFavorites, ...validFavorites.slice(1), { code: 'AMS', name: 'Duplicate' }] })
    expect(api.state.favorites).toEqual([
      { code: 'UT', name: 'Utrecht Centraal', label: 'Utrecht Centraal', icon: 'default' },
      { code: 'ASD', name: 'Amsterdam Centraal', label: 'Amsterdam Centraal', icon: 'default' },
      { code: 'ASA', name: 'Amsterdam Amstel', label: 'Amsterdam Amstel', icon: 'default' },
      { code: 'BER', name: 'Berlin', label: 'Berlin', icon: 'default' },
      { code: 'AMS', name: 'Amsterdam Airport', label: 'Airport', icon: 'home' },
    ])
    for (let i = 0; i < validFavorites.length; i++) {
      click('#fav-list .favmenu[data-fi="' + i + '"]')
      expect(element<HTMLInputElement>('#fav-name').value).toBe(api.state.favorites[i].label)
      click('#fav-save')
    }
    await flush()
    expect(JSON.parse(mocks.bridge.setLocalStorage.mock.calls.at(-1)![1])).toEqual(api.state.favorites)
    click('#fav-list .favmenu[data-fi="0"]')
    click('#fav-remove')
    expect(api.state.favorites.map((f: any) => f.code)).toEqual(['ASD', 'ASA', 'BER', 'AMS'])
  })

  it('updates the home lens selection immediately when a selected route is removed', async () => {
    const nextRoute = { fromCode: 'ASD', fromName: 'Amsterdam Centraal', toCode: 'ASA', toName: 'Amsterdam Amstel' }
    await boot({ routes: [route, nextRoute] })
    expect(lens()).toContain('> 1. Utrecht Centraal to Amsterdam Centraal')
    click('#saved .del')
    await flush()
    expect(element('#saved').textContent).toContain('Amsterdam Centraal')
    expect(element('#saved').textContent).not.toContain('Utrecht Centraal')
    expect(lens()).toContain('> 1. Amsterdam Centraal to Amsterdam Amstel')
    expect(lens()).not.toContain('Utrecht Centraal')
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(mocks.trips).toHaveBeenCalledWith('ASD', 'ASA', { lang: 'en' })
  })

  it('clears the home lens immediately when the last saved route is removed', async () => {
    await boot({ routes: [route] })
    click('#saved .del')
    await flush()
    expect(api.state.savedRoutes).toEqual([])
    expect(element('#saved').textContent).toContain('no recently planned journeys')
    expect(lens()).toContain('Please set a route')
    expect(lens()).not.toContain('Utrecht Centraal')
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(mocks.trips).not.toHaveBeenCalled()
  })

  it('deduplicates routes, caps history at eight, and persists additions and removals', async () => {
    await boot({ routes: Array.from({ length: 8 }, (_, i) => ({ ...route, toCode: 'T' + i, toName: 'Target ' + i })) })
    api.addRoute(route)
    api.addRoute(route)
    expect(api.state.savedRoutes).toHaveLength(8)
    expect(api.state.savedRoutes[0]).toEqual(route)
    click('#saved .del')
    expect(api.state.savedRoutes).toHaveLength(7)
    expect(mocks.trips).not.toHaveBeenCalled()
    expect(JSON.parse(mocks.bridge.setLocalStorage.mock.calls.at(-1)![1])).toHaveLength(7)
    element('#saved .del').dataset.ri = '999'
    click('#saved .del')
    expect(api.state.savedRoutes).toHaveLength(7)
  })

  it('reports persistence failures without dropping the in-memory state', async () => {
    await boot()
    mocks.bridge.setLocalStorage.mockRejectedValue(new Error('full'))
    api.addRoute(route)
    api.addFavorite({ code: 'UT', name: 'Utrecht' })
    await api.persistLang()
    await flush()
    expect(console.error).toHaveBeenCalledWith('persistRoutes failed:', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('persistFavorites failed:', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('persistLang failed:', expect.any(Error))
    expect(api.state.savedRoutes).toHaveLength(1)
    expect(api.state.favorites).toHaveLength(1)
  })
})

describe('station autocomplete and planning', () => {
  it('recovers a saved route after the startup station request fails', async () => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot({ routes: [route] })
    expect(api.state.stationList).toEqual([])
    expect(api.state.stationLoadError).toBe(true)
    expect(api.state.stationLoad).toBeNull()
    const recovery = deferred<StationInfo[]>()
    mocks.stations.mockReturnValueOnce(recovery.promise)
    click('#saved .chip')
    expect(element('#results').textContent).toBe('Loading stations…')
    expect(mocks.trips).not.toHaveBeenCalled()
    recovery.resolve(stations)
    await flush()
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    expect(mocks.trips).toHaveBeenCalledWith('UT', 'ASD', { lang: 'en' })
    expect(element('#results .trip-card').textContent).toContain('IC')
    expect(api.state.stationLoadError).toBe(false)
    expect(api.state.stationLoad).toBeNull()
    expect(await api.loadStations()).toBe(true)
    expect(mocks.stations).toHaveBeenCalledTimes(2)
  })

  it('recovers manually entered stations without sending typed queries', async () => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot()
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    expect(element('#from-list').textContent).toBe('Could not load stations. Try again when connected.')
    expect(mocks.stations).toHaveBeenCalledOnce()
    await api.planJourney()
    expect(mocks.trips).toHaveBeenCalledWith('UT', 'ASD', { lang: 'en' })
    input('#from', 'ams')
    input('#from', 'ut')
    expect(mocks.stations.mock.calls).toEqual([[], []])
  })

  it('shares one recovery request across planning, searching, and favorite actions', async () => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot()
    const recovery = deferred<StationInfo[]>()
    mocks.stations.mockReturnValueOnce(recovery.promise)
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    input('#fav-input', 'ut')
    element('#from').focus()
    expect(element('#from-list').textContent).toBe('Loading stations…')
    click('#fav-add')
    api.useFavorite({ code: 'ASD', name: route.toName })
    const planning = api.planJourney()
    const first = api.loadStations()
    expect(api.loadStations()).toBe(first)
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    expect(element('#fav-add').textContent).toBe('Loading stations…')
    recovery.resolve(stations)
    await planning
    await flush()
    expect(mocks.stations.mock.calls).toEqual([[], []])
    expect(mocks.trips).toHaveBeenCalledOnce()
    expect(api.state.favorites).toEqual([{ code: 'UT', name: route.fromName, label: route.fromName, icon: 'default' }])
    expect(element('#fav-add').textContent).toBe('Add')
    expect(element('#from-list .option-name').textContent).toBe(route.fromName)
  })

  it('reports repeated recovery failures and retries only after user actions', async () => {
    mocks.stations.mockRejectedValue(new Error('offline'))
    await boot({ routes: [route] })
    input('#fav-input', 'ut')
    click('#saved .chip')
    click('#plan')
    click('#fav-add')
    await flush()
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    expect(element('#results').textContent).toBe('Could not load stations. Try again when connected.')
    expect(element('.modal-text').textContent).toBe('Could not load stations. Try again when connected.')
    expect(element('#fav-add').textContent).toBe('Add')
    expect(api.state.stationLoad).toBeNull()
    expect(api.state.stationLoadError).toBe(true)
    await api.planJourney()
    await api.planJourney()
    expect(mocks.stations).toHaveBeenCalledTimes(4)
    expect(mocks.trips).not.toHaveBeenCalled()
    expect(api.state.favorites).toEqual([])
    await vi.advanceTimersByTimeAsync(120000)
    expect(mocks.stations).toHaveBeenCalledTimes(4)
    mocks.stations.mockResolvedValueOnce(stations)
    await api.planJourney()
    expect(mocks.trips).toHaveBeenCalledWith('UT', 'ASD', { lang: 'en' })
  })

  it('treats an empty station catalog as unavailable and allows recovery', async () => {
    mocks.stations.mockResolvedValueOnce([])
    await boot()
    expect(api.state.stationLoadError).toBe(true)
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    await api.planJourney()
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    expect(mocks.trips).toHaveBeenCalledOnce()
  })

  it('refreshes the current local search when the initial catalog arrives', async () => {
    const initial = deferred<StationInfo[]>()
    mocks.stations.mockReturnValueOnce(initial.promise)
    await boot()
    element('#from').focus()
    input('#from', 'ut')
    key('#from', 'ArrowDown')
    key('#from', 'Enter')
    expect(element<HTMLInputElement>('#from').dataset.code).toBeUndefined()
    input('#from', 'ams')
    expect(element('#from-list').textContent).toBe('Loading stations…')
    initial.resolve(stations)
    await flush()
    expect(element('#from-list .option-name').textContent).toBe('Amsterdam Airport')
    expect(mocks.stations.mock.calls).toEqual([[]])
  })

  it('reports a focused search recovery failure and recovers on the next focus', async () => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot()
    const retry = deferred<StationInfo[]>()
    mocks.stations.mockReturnValueOnce(retry.promise)
    input('#from', 'ut')
    element('#from').focus()
    retry.reject(new Error('still offline'))
    await flush()
    expect(element('#from-list').hidden).toBe(false)
    expect(element('#from-list').textContent).toBe('Could not load stations. Try again when connected.')
    element('#plan').focus()
    await vi.advanceTimersByTimeAsync(120)
    element('#from').focus()
    await flush()
    expect(element('#from-list .option-name').textContent).toBe(route.fromName)
    expect(mocks.stations).toHaveBeenCalledTimes(3)
  })

  it.each(['escaped', 'unfocused'])('keeps an %s search closed after recovery', async (state) => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot()
    const retry = deferred<StationInfo[]>()
    mocks.stations.mockReturnValueOnce(retry.promise)
    input('#from', 'ut')
    element('#from').focus()
    if (state === 'escaped') {
      key('#from', 'Escape')
    } else {
      element('#to').focus()
      await vi.advanceTimersByTimeAsync(120)
    }
    retry.resolve(stations)
    await flush()
    expect(element('#from-list').hidden).toBe(true)
    expect(element('#to-list').hidden).toBe(true)
    expect(mocks.stations).toHaveBeenCalledTimes(2)
  })

  it('recovers the catalog when adding a favorite from typed text', async () => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot()
    input('#fav-input', 'ut')
    click('#fav-add')
    expect(element('#fav-add').textContent).toBe('Loading stations…')
    await flush()
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    expect(api.state.favorites).toEqual([{ code: 'UT', name: route.fromName, label: route.fromName, icon: 'default' }])
    expect(element('#fav-add').textContent).toBe('Add')
    expect(element<HTMLInputElement>('#fav-input').value).toBe('')
    expect(mocks.trips).not.toHaveBeenCalled()
  })

  it('recovers the catalog when selecting an existing favorite', async () => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot({ favorites: [{ code: 'ASD', name: route.toName }] })
    click('#fav-list .fav')
    await flush()
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    expect(element<HTMLInputElement>('#to').dataset.code).toBe('ASD')
    input('#from', 'ut')
    await api.planJourney()
    expect(mocks.trips).toHaveBeenCalledWith('UT', 'ASD', { lang: 'en' })
  })

  it.each(['edit', 'clear', 'swap', 'favorite'].flatMap((action) => ['resolve', 'reject'].map((outcome) => [action, outcome])))('cancels a plan on %s while station recovery can still %s', async (action, outcome) => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot({ routes: [route], favorites: [{ code: 'ASA', name: amstelRoute.toName }] })
    input('#from', route.fromName, route.fromCode)
    input('#to', route.toName, route.toCode)
    await flush()
    const recovery = deferred<StationInfo[]>()
    mocks.stations.mockReturnValueOnce(recovery.promise)
    const planning = api.planJourney()
    expect(element('#results').textContent).toBe('Loading stations…')
    if (action === 'edit') {
      input('#to', amstelRoute.toName, amstelRoute.toCode)
      input('#to', route.toName, route.toCode)
    } else if (action === 'clear') {
      click('#clear-search')
    } else if (action === 'swap') {
      click('#swap')
      click('#swap')
    } else {
      click('#fav-list .fav')
    }
    await flush()
    const writes = mocks.bridge.setLocalStorage.mock.calls.length
    if (outcome === 'resolve') recovery.resolve(stations)
    else recovery.reject(new Error('still offline'))
    await planning
    await flush()
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    expect(mocks.trips).not.toHaveBeenCalled()
    expect(mocks.bridge.setLocalStorage.mock.calls).toHaveLength(writes)
    expect(api.state.phoneRoute).toBeNull()
    expect(api.state.detailRoute).toBeNull()
    expect(api.state.view).toBe('home')
    expect(api.state.savedRoutes).toEqual([route])
    expect(element('#results').innerHTML).toBe('')
    expect(element('#error-modal').hidden).toBe(true)
    expect(lens()).toContain('Please set a route')
  })

  it.each(['resolve', 'reject'])('lets only the newer plan proceed when shared station recovery %ss', async (outcome) => {
    mocks.stations.mockRejectedValueOnce(new Error('offline'))
    await boot()
    input('#from', route.fromName, route.fromCode)
    input('#to', route.toName, route.toCode)
    await flush()
    const recovery = deferred<StationInfo[]>()
    mocks.stations.mockReturnValueOnce(recovery.promise)
    const setter = vi.spyOn(api.state.results, 'innerHTML', 'set')
    const older = api.planJourney()
    input('#to', amstelRoute.toName, amstelRoute.toCode)
    const newer = api.planJourney()
    expect(mocks.stations).toHaveBeenCalledTimes(2)
    if (outcome === 'resolve') recovery.resolve(stations)
    else recovery.reject(new Error('still offline'))
    await Promise.all([older, newer])
    await flush()
    const failures = setter.mock.calls.filter(([html]) => html.includes('Could not load stations'))
    if (outcome === 'resolve') {
      expect(failures).toHaveLength(0)
      expect(mocks.trips).toHaveBeenCalledExactlyOnceWith('UT', 'ASA', { lang: 'en' })
      expect(api.state.phoneRoute).toEqual(amstelRoute)
      expect(api.state.savedRoutes).toEqual([amstelRoute])
      expect(element('#results .trip-card')).toBeDefined()
    } else {
      expect(failures).toHaveLength(1)
      expect(mocks.trips).not.toHaveBeenCalled()
      expect(api.state.phoneRoute).toBeNull()
      expect(api.state.savedRoutes).toEqual([])
      expect(element('#results').textContent).toBe('Could not load stations. Try again when connected.')
    }
    expect(element('#error-modal').hidden).toBe(true)
    setter.mockRestore()
  })

  it('ranks names, codes, and synonyms and limits suggestions to seven', async () => {
    await boot()
    expect(api.rankStations('ams').map((s: StationInfo) => s.code)).toEqual(['AMS', 'AMS5', 'AMS4', 'AMS3', 'AMS2', 'ASA', 'ASD'])
    expect(api.rankStations('centraal').map((s: StationInfo) => s.code)).toEqual(['ASD', 'UT'])
    expect(api.rankStations('ut')[0].code).toBe('UT')
    expect(api.rankStations('connection')[0].code).toBe('BER')
    expect(api.rankStations('no match')).toEqual([])
    expect(api.nameForCode('unknown')).toBe('unknown')
  })

  it('supports keyboard, mouse, hover, blur, empty, and unmatched suggestions', async () => {
    await boot()
    key('#from', 'ArrowDown')
    input('#from', 'ams')
    expect(element('#from-list').hidden).toBe(false)
    key('#from', 'ArrowDown')
    key('#from', 'ArrowDown')
    key('#from', 'ArrowUp')
    key('#from', 'Enter')
    expect(element<HTMLInputElement>('#from').dataset.code).toBe('AMS')
    input('#from', 'ut')
    key('#from', 'Enter')
    expect(element<HTMLInputElement>('#from').dataset.code).toBe('UT')
    input('#to', 'ams')
    const option = element('#to-list .option')
    option.dispatchEvent(new MouseEvent('mouseenter'))
    expect(option.classList.contains('active')).toBe(true)
    option.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }))
    expect(element<HTMLInputElement>('#to').dataset.code).toBe('AMS')
    input('#from', 'ber')
    expect(element('#from-list .option-country').textContent).toBe('DE')
    key('#from', 'x')
    key('#from', 'Escape')
    expect(element('#from-list').hidden).toBe(true)
    input('#from', '   ')
    expect(element('#from-list').hidden).toBe(true)
    input('#from', 'nonexistent')
    expect(element('#from-list').hidden).toBe(true)
    input('#from', 'ut')
    element('#from').dispatchEvent(new Event('blur'))
    await vi.advanceTimersByTimeAsync(120)
    expect(element('#from-list').hidden).toBe(true)
  })

  it('toggles autocomplete favorites without selecting the station', async () => {
    await boot()
    input('#from', 'ut')
    const star = element('#from-list .option-star')
    star.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(api.state.favorites).toHaveLength(0)
    star.click()
    expect(api.state.favorites).toHaveLength(1)
    expect(element<HTMLInputElement>('#from').dataset.code).toBeUndefined()
    expect(element<HTMLInputElement>('#from').value).toBe('ut')
    expect(element('#from-list').hidden).toBe(false)
    star.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(api.state.favorites).toHaveLength(1)
    star.click()
    expect(api.state.favorites).toHaveLength(0)
  })

  it('prioritizes exact station codes over alphabetical names and domestic prefixes', async () => {
    await boot()
    expect(api.rankStations('ED').map((s: StationInfo) => s.code)).toEqual(['ED', 'EDC'])
    expect(api.rankStations('bEr').map((s: StationInfo) => s.code)).toEqual(['BER', 'BGN'])
    input('#from', 'ed')
    key('#from', 'Enter')
    expect(element<HTMLInputElement>('#from').dataset.code).toBe('ED')
    input('#to', 'BER')
    key('#to', 'Enter')
    expect(element<HTMLInputElement>('#to').dataset.code).toBe('BER')
    click('#plan')
    await flush()
    expect(mocks.trips).toHaveBeenCalledWith('ED', 'BER', { lang: 'en' })
  })

  it('starts ArrowUp at the last suggestion and wraps in both directions', async () => {
    await boot()
    input('#from', 'ede')
    const options = element('#from-list').children
    key('#from', 'ArrowUp')
    expect(options[options.length - 1].classList.contains('active')).toBe(true)
    key('#from', 'ArrowDown')
    expect(options[0].classList.contains('active')).toBe(true)
    key('#from', 'ArrowUp')
    key('#from', 'Enter')
    expect(element<HTMLInputElement>('#from').dataset.code).toBe('ED')
  })

  it('cancels delayed blur when refocused and restores unresolved suggestions after closing', async () => {
    await boot()
    const field = input('#from', 'ed')
    field.focus()
    element('#plan').focus()
    await vi.advanceTimersByTimeAsync(60)
    field.focus()
    await vi.advanceTimersByTimeAsync(120)
    expect(element('#from-list').hidden).toBe(false)
    expect(field.getAttribute('aria-expanded')).toBe('true')
    element('#plan').focus()
    await vi.advanceTimersByTimeAsync(120)
    expect(element('#from-list').hidden).toBe(true)
    field.focus()
    expect(element('#from-list').hidden).toBe(false)
    key('#from', 'Enter')
    element('#plan').focus()
    await vi.advanceTimersByTimeAsync(120)
    field.focus()
    expect(element('#from-list').hidden).toBe(true)
    expect(field.dataset.code).toBe('ED')
  })

  it('keeps suggestions while favorite buttons have keyboard focus and closes on leaving them', async () => {
    await boot()
    const field = input('#from', 'ed')
    field.focus()
    const first = element<HTMLButtonElement>('#from-list .option:first-child .option-star')
    const second = element<HTMLButtonElement>('#from-list .option:last-child .option-star')
    field.dispatchEvent(new FocusEvent('blur'))
    await vi.advanceTimersByTimeAsync(60)
    first.focus()
    await vi.advanceTimersByTimeAsync(120)
    expect(element('#from-list').hidden).toBe(false)
    expect(document.activeElement).toBe(first)
    first.click()
    expect(api.state.favorites.map((f: any) => f.code)).toEqual(['ED'])
    expect(field.dataset.code).toBeUndefined()
    expect(field.value).toBe('ed')
    second.focus()
    await vi.advanceTimersByTimeAsync(120)
    expect(element('#from-list').hidden).toBe(false)
    second.click()
    expect(api.state.favorites.map((f: any) => f.code)).toEqual(['ED', 'EDC'])
    field.focus()
    await vi.advanceTimersByTimeAsync(120)
    expect(element('#from-list').hidden).toBe(false)
    element<HTMLButtonElement>('#from-list .option-star').focus()
    element('#plan').focus()
    await vi.advanceTimersByTimeAsync(120)
    expect(element('#from-list').hidden).toBe(true)
  })

  it.each(['from', 'to'])('resets a displayed itinerary when choosing a %s suggestion', async (field) => {
    await boot()
    input('#from', field === 'from' ? 'ed' : 'ut')
    input('#to', field === 'to' ? 'ed' : 'ut')
    click('#plan')
    await flush()
    expect(element('#results .trip-card')).toBeDefined()
    element('#' + field).focus()
    element('#' + field + '-list .option:last-child').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(element<HTMLInputElement>('#' + field).dataset.code).toBe('EDC')
    expect(element('#results').innerHTML).toBe('')
    expect(element('#home-sections').hidden).toBe(false)
    expect(api.state.view).toBe('home')
    expect(api.state.detailRoute).toBeNull()
    expect(api.state.detailTrips).toEqual([])
  })

  it('resets loading state when choosing a suggestion and supports the favorite search', async () => {
    await boot()
    input('#from', 'ut')
    const field = input('#to', 'ed')
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    const planning = api.planJourney()
    await flush()
    expect(api.state.detailStatus).toBe('loading')
    field.focus()
    key('#to', 'ArrowDown')
    key('#to', 'ArrowDown')
    key('#to', 'Enter')
    expect(field.dataset.code).toBe('EDC')
    expect(element('#results').innerHTML).toBe('')
    expect(api.state.view).toBe('home')
    expect(api.state.detailRoute).toBeNull()
    pending.resolve([])
    await planning
    input('#fav-input', 'ed')
    key('#fav-input', 'Enter')
    expect(element<HTMLInputElement>('#fav-input').dataset.code).toBe('ED')
    click('#fav-add')
    expect(api.state.favorites[0].code).toBe('ED')
  })

  it('swaps field values and removes absent station codes', async () => {
    await boot()
    input('#from', 'Utrecht', 'UT')
    input('#to', 'Amsterdam', 'ASD')
    click('#swap')
    expect(element<HTMLInputElement>('#from').dataset.code).toBe('ASD')
    expect(element<HTMLInputElement>('#to').dataset.code).toBe('UT')
    input('#from', 'uncoded')
    input('#to', 'also uncoded')
    click('#swap')
    expect(element<HTMLInputElement>('#from').value).toBe('also uncoded')
    expect(element<HTMLInputElement>('#from').dataset.code).toBeUndefined()
    expect(element<HTMLInputElement>('#to').dataset.code).toBeUndefined()
  })

  it('validates missing, unmatched, and identical stations and dismisses error dialogs', async () => {
    await boot()
    click('#plan')
    expect(element('#error-modal').hidden).toBe(false)
    expect(element('.modal-text').textContent).toBe('Pick both a From and To station.')
    click('.modal-card')
    expect(element('#error-modal').hidden).toBe(false)
    click('.modal-ok')
    expect(element('#error-modal').hidden).toBe(true)
    input('#from', 'no match')
    input('#to', 'ut')
    click('#plan')
    key('#to', 'Escape')
    expect(element('#error-modal').hidden).toBe(true)
    input('#from', 'ut')
    click('#plan')
    expect(element('.modal-text').textContent).toBe('From and To are the same station.')
    click('#error-modal')
    expect(element('#error-modal').hidden).toBe(true)
    expect(mocks.trips).not.toHaveBeenCalled()
  })

  it('plans, mirrors, opens detail, and clears an itinerary', async () => {
    await boot()
    input('#from', 'Utrecht')
    input('#to', 'Amsterdam Centraal')
    click('#plan')
    await flush()
    expect(mocks.trips).toHaveBeenCalledWith('UT', 'ASD', { lang: 'en' })
    expect(element('#home-sections').hidden).toBe(true)
    expect(element('#results .trip-card').textContent).toContain('IC')
    expect(lens()).toContain('Utrecht Centraal > Amsterdam Centraal')
    click('#results .trip-card')
    await flush()
    expect(element('#detail').hidden).toBe(false)
    expect(lens()).toContain('ETA:')
    click('#detail-back')
    await flush()
    expect(api.state.view).toBe('list')
    click('#clear-search')
    await flush()
    expect(element<HTMLInputElement>('#from').value).toBe('')
    expect(element<HTMLInputElement>('#to').value).toBe('')
    expect(element('#results').innerHTML).toBe('')
    expect(element('#home-sections').hidden).toBe(false)
    expect(api.state.view).toBe('home')
    expect(document.activeElement).toBe(element('#from'))
  })

  it('plans saved routes and resets results when either field is edited', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    expect(mocks.trips).toHaveBeenCalledOnce()
    input('#to', 'new')
    expect(element('#results').innerHTML).toBe('')
    expect(api.state.view).toBe('home')
    input('#to', 'Amsterdam', 'ASD')
    await api.planJourney()
    input('#from', 'edited')
    expect(element('#results').innerHTML).toBe('')
  })

  it.each([new Error('offline'), 'not available'])('reports planning failure %s', async (error) => {
    await boot()
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    mocks.trips.mockRejectedValueOnce(error)
    await api.planJourney()
    expect(element('.modal-text').textContent).toContain(error instanceof Error ? error.message : error)
    expect(element('#results').innerHTML).toBe('')
    expect(element('#home-sections').hidden).toBe(false)
    expect(api.state.detailStatus).toBe('error')
  })

  it('renders empty results and protects lens state from a stale planning response', async () => {
    await boot()
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    mocks.trips.mockResolvedValueOnce([])
    await api.planJourney()
    await flush()
    expect(element('#results').textContent).toBe('No journeys found.')
    expect(lens()).toContain('No departures found')
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    const planning = api.planJourney()
    api.mirrorHomeToLens()
    pending.resolve([trip()])
    await planning
    expect(api.state.detailTrips).toEqual([])
    const failure = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(failure.promise)
    const rejected = api.planJourney()
    api.mirrorHomeToLens()
    failure.reject(new Error('late failure'))
    await rejected
    expect(api.state.detailRoute).toBeNull()
  })
})

describe('favorites and language', () => {
  it('focuses the editor and returns to a replacement favorite action after saving or removing', async () => {
    await boot({ favorites: [{ code: 'UT', name: 'Utrecht' }, { code: 'ASD', name: 'Amsterdam' }] })
    const menu = element('#fav-list .favmenu')
    menu.focus()
    click('#fav-list .favmenu')
    expect(document.activeElement).toBe(element('#fav-back'))
    expect(element('#app').hasAttribute('inert')).toBe(true)
    key('#fav-back', 'Escape')
    expect(document.activeElement).toBe(menu)
    expect(element('#app').hasAttribute('inert')).toBe(false)
    click('#fav-list .favmenu')
    input('#fav-name', 'Work')
    click('#fav-save')
    expect(document.activeElement).toBe(element('#fav-list .favmenu'))
    expect(document.activeElement).not.toBe(menu)
    click('#fav-list .favmenu')
    element('#fav-name').focus()
    api.showFavEdit(0)
    expect(document.activeElement).toBe(element('#fav-name'))
    click('#fav-remove')
    expect(document.activeElement).toBe(element('#fav-list .favmenu'))
    click('#fav-list .favmenu')
    click('#fav-remove')
    expect(document.activeElement).toBe(element('#fav-input'))
    expect(element('#app').hasAttribute('inert')).toBe(false)
  })

  it('provides primary row buttons separate from edit and remove actions', async () => {
    await boot({ routes: [route], favorites: [{ code: 'UT', name: 'Utrecht' }] })
    const favorite = element<HTMLButtonElement>('#fav-list .row-select')
    const saved = element<HTMLButtonElement>('#saved .row-select')
    for (const button of [favorite, saved]) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.type).toBe('button')
      expect(button.tabIndex).toBe(0)
      expect(button.querySelector('button')).toBeNull()
    }
    key('#fav-list .favmenu', 'Enter')
    key('#fav-list .favmenu', ' ')
    click('#fav-list .favmenu')
    expect(element<HTMLInputElement>('#to').value).toBe('')
    expect(element('#fav-edit').hidden).toBe(false)
    click('#fav-back')
    favorite.click()
    expect(element<HTMLInputElement>('#to').dataset.code).toBe('UT')
    saved.click()
    await flush()
    expect(mocks.trips).toHaveBeenCalledOnce()
    api.showPlanAgain(true)
    key('#saved .del', 'Enter')
    key('#saved .del', ' ')
    click('#saved .del')
    expect(api.state.savedRoutes).toEqual([])
    expect(mocks.trips).toHaveBeenCalledOnce()
  })

  it('focuses the current language and navigates, selects, and dismisses options with the keyboard', async () => {
    await boot()
    const toggle = element('#lang-toggle')
    toggle.focus()
    click('#lang-toggle')
    expect(document.activeElement).toBe(element('#lang-menu .option:first-child'))
    expect(element('#lang-menu .option:first-child').tabIndex).toBe(0)
    expect(element('#lang-menu .option:last-child').tabIndex).toBe(-1)
    key('#lang-menu .option:first-child', 'ArrowDown')
    expect(document.activeElement).toBe(element('#lang-menu .option:last-child'))
    expect(element('#lang-menu .option:first-child').tabIndex).toBe(-1)
    key('#lang-menu .option:last-child', 'ArrowDown')
    expect(document.activeElement).toBe(element('#lang-menu .option:first-child'))
    key('#lang-menu .option:first-child', 'ArrowUp')
    expect(document.activeElement).toBe(element('#lang-menu .option:last-child'))
    key('#lang-menu .option:last-child', 'Home')
    expect(document.activeElement).toBe(element('#lang-menu .option:first-child'))
    key('#lang-menu .option:first-child', 'End')
    expect(document.activeElement).toBe(element('#lang-menu .option:last-child'))
    key('#lang-menu .option:last-child', 'x')
    expect(api.tripOpts().lang).toBe('en')
    key('#lang-menu .option:last-child', 'Enter')
    expect(api.tripOpts().lang).toBe('nl')
    expect(document.activeElement).toBe(toggle)
    click('#lang-toggle')
    expect(document.activeElement).toBe(element('#lang-menu .option:last-child'))
    key('#lang-menu .option:last-child', 'ArrowUp')
    key('#lang-menu .option:first-child', ' ')
    expect(api.tripOpts().lang).toBe('en')
    expect(document.activeElement).toBe(toggle)
    click('#lang-toggle')
    key('#lang-menu .option:first-child', 'Escape')
    expect(element('#lang-menu').hidden).toBe(true)
    expect(document.activeElement).toBe(toggle)
  })

  it('adds once, selects, edits, clears, saves icons, and removes favorites', async () => {
    await boot()
    click('#fav-add')
    expect(element<HTMLInputElement>('#fav-input').placeholder).toBe('Pick a station first')
    input('#fav-input', 'ut')
    click('#fav-add')
    api.addFavorite({ code: 'UT', name: 'Duplicate' })
    api.addFavorite({ code: 'ASD', name: 'Amsterdam' })
    expect(api.state.favorites).toHaveLength(2)
    click('#fav-list .fav')
    expect(element<HTMLInputElement>('#to').dataset.code).toBe('UT')
    click('#fav-list .favmenu')
    expect(element('#fav-edit').hidden).toBe(false)
    click('#fav-name-clear')
    expect(element<HTMLInputElement>('#fav-name').value).toBe('')
    click('[data-icon="home"]')
    click('#fav-save')
    expect(api.state.favorites[0]).toMatchObject({ label: 'Utrecht Centraal', icon: 'home' })
    click('#fav-list .favmenu')
    input('#fav-name', '  My "Office"  ')
    click('[data-icon="work"]')
    click('#fav-save')
    expect(api.state.favorites[0]).toMatchObject({ label: 'My "Office"', icon: 'work' })
    click('#fav-list .favmenu')
    expect(element<HTMLInputElement>('#fav-name').value).toBe('My "Office"')
    click('#fav-back')
    expect(element('#fav-edit').hidden).toBe(true)
    click('#fav-list .favmenu')
    click('#fav-remove')
    expect(api.state.favorites).toHaveLength(1)
    api.showFavEdit(99)
    expect(element('#fav-edit').hidden).toBe(true)
  })

  it('opens, closes, selects, persists, and localizes the language menu', async () => {
    await boot()
    click('#lang-toggle')
    expect(element('#lang-menu').hidden).toBe(false)
    click('#lang-menu .option')
    expect(mocks.bridge.setLocalStorage).not.toHaveBeenCalled()
    click('#lang-toggle')
    click('#lang-toggle')
    expect(element('#lang-menu').hidden).toBe(true)
    click('#lang-toggle')
    element('#lang-menu').click()
    expect(element('#lang-menu').hidden).toBe(false)
    click('#lang-menu .option:nth-child(2)')
    await flush()
    expect(api.tripOpts().lang).toBe('nl')
    expect(mocks.bridge.setLocalStorage).toHaveBeenCalledWith('perron-ns.lang.v1', 'nl')
    expect(element('#lang-menu .option:nth-child(2)').getAttribute('aria-selected')).toBe('true')
    click('#lang-toggle')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(element('#lang-menu').hidden).toBe(true)
    click('#lang-toggle')
    document.body.click()
    expect(element('#lang-menu').hidden).toBe(true)
    document.body.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
  })
})

describe('glasses navigation and refresh', () => {
  it('ignores empty navigation and cleans up exactly once on exit', async () => {
    await boot()
    eventHandler({})
    eventHandler({ textEvent: {} })
    eventHandler({ textEvent: { eventType: null } })
    gesture(OsEventTypeList.SCROLL_TOP_EVENT)
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    eventHandler({ sysEvent: {} })
    await flush()
    expect(mocks.trips).not.toHaveBeenCalled()
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT, true)
    gesture(OsEventTypeList.ABNORMAL_EXIT_EVENT, true)
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(mocks.bridge.shutDownPageContainer).toHaveBeenCalledWith(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caps and cycles journeys and trips, opens details, and steps back', async () => {
    await boot({ routes: [route, { ...route, toCode: 'ASA', toName: 'Amstel' }, { ...route, toCode: 'BER', toName: 'Berlin' }, { ...route, toCode: 'X', toName: 'Hidden' }] })
    expect(api.visibleJourneyCount()).toBe(3)
    gesture(OsEventTypeList.SCROLL_TOP_EVENT)
    await flush()
    expect(api.state.journeyIdx).toBe(2)
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    await flush()
    expect(api.state.journeyIdx).toBe(0)
    mocks.trips.mockResolvedValue(Array.from({ length: 6 }, (_, i) => trip({ departure: '2026-10-02T10:' + (20 + i) + ':00Z', transfers: i })))
    eventHandler({ sysEvent: { eventType: null } })
    await flush()
    expect(api.visibleTripCount()).toBe(5)
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    gesture(OsEventTypeList.SCROLL_TOP_EVENT)
    await flush()
    expect(api.state.tripIdx).toBe(0)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(api.state.view).toBe('detail')
    gesture(OsEventTypeList.SCROLL_TOP_EVENT)
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    expect(api.state.view).toBe('detail')
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    await flush()
    expect(api.state.view).toBe('home')
    gesture(OsEventTypeList.SYSTEM_EXIT_EVENT, true)
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })

  it.each([[], new Error('offline'), 'failure'])('handles empty or failed lens requests: %s', async (value) => {
    await boot({ routes: [route] })
    if (Array.isArray(value)) mocks.trips.mockResolvedValueOnce(value)
    else mocks.trips.mockRejectedValueOnce(value)
    await api.openTripList()
    expect(api.state.detailStatus).toBe('error')
    expect(lens()).toContain(Array.isArray(value) ? 'No departures found' : value instanceof Error ? value.message : value)
    api.openTripDetail()
    api.cycleTrip(1)
    expect(api.state.view).toBe('list')
  })

  it('keeps a loading request from replacing a newer lens route', async () => {
    await boot({ routes: [route] })
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    const opening = api.openTripList()
    await flush()
    expect(lens()).toContain('Loading times...')
    api.mirrorHomeToLens()
    await flush()
    const count = mocks.bridge.textContainerUpgrade.mock.calls.length
    pending.resolve([trip()])
    await opening
    expect(mocks.bridge.textContainerUpgrade.mock.calls.length).toBe(count)
  })

  it('preserves selected departures across refresh, clamps indices, and handles missing matches', async () => {
    await boot({ routes: [route] })
    await api.openTripList()
    const original = trip()
    mocks.trips.mockResolvedValueOnce([trip({ departure: 'earlier' }), original])
    await api.refreshOpenTrips()
    expect(api.state.tripIdx).toBe(1)
    mocks.trips.mockResolvedValueOnce([trip({ departure: 'new' })])
    await api.refreshOpenTrips()
    expect(api.state.tripIdx).toBe(0)
    api.state.tripIdx = 7
    mocks.trips.mockResolvedValueOnce(Array.from({ length: 6 }, (_, i) => trip({ departure: 'new' + i })))
    await api.refreshOpenTrips()
    expect(api.state.tripIdx).toBe(4)
    api.state.detailTrips = [trip({ departure: '' })]
    api.state.tripIdx = 0
    mocks.trips.mockResolvedValueOnce([trip()])
    await api.refreshOpenTrips()
    expect(api.state.tripIdx).toBe(0)
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.trips.mock.calls.length).toBeGreaterThan(4)
  })

  it('ignores failed, empty, and stale refreshes', async () => {
    await boot({ routes: [route] })
    await api.refreshOpenTrips()
    expect(mocks.trips).not.toHaveBeenCalled()
    await api.openTripList()
    const original = api.state.detailTrips
    mocks.trips.mockRejectedValueOnce(new Error('offline'))
    await api.refreshOpenTrips()
    mocks.trips.mockResolvedValueOnce([])
    await api.refreshOpenTrips()
    expect(api.state.detailTrips).toBe(original)
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    const refresh = api.refreshOpenTrips()
    api.mirrorHomeToLens()
    pending.resolve([trip()])
    await refresh
    expect(api.state.detailTrips).toEqual([])
    api.state.detailRoute = route
    api.state.view = 'home'
    await api.refreshOpenTrips()
    expect(api.state.view).toBe('home')
  })

  it('formats lens bounds, delays, cancellations, platforms, transfers, and missing data', async () => {
    await boot({ routes: [route] })
    api.state.journeyIdx = 9
    expect(api.lensContent()).toContain('> 1.')
    await api.openTripList()
    api.state.detailTrips = [trip({ legs: [], cancelled: true }), trip({ cancelled: true, cancellationReason: 'Track work', legs: [leg({ mode: 'BUS', displayName: 'Bus', service: 'Bus 320', trainNumber: '320', originTrack: '', destinationTrack: '' }), leg({ mode: 'OTHER', departure: '2026-10-02T10:40:00Z' })] })]
    api.state.tripIdx = 9
    expect(api.listContent()).toContain('CANCELLED')
    expect(api.state.tripIdx).toBe(1)
    expect(api.detailContent()).toContain('CANCELLED — Track work')
    expect(api.detailContent()).toContain('Bus 320 · Trip:')
    expect(api.detailContent()).toContain('Change (0 min)')
    api.state.tripIdx = 0
    expect(api.detailContent()).toContain('CANCELLED')
    api.state.detailTrips = []
    expect(api.detailContent()).toContain('No departures found')
    api.state.detailStatus = 'ready'
    api.openTripDetail()
    api.cycleTrip(1)
    expect(api.state.view).toBe('list')
    api.state.detailRoute = null
    expect(api.listContent()).toContain('Please set a route')
    expect(api.detailContent()).toContain('Please set a route')
    api.mirrorDetailToLens(-1)
    api.mirrorDetailToLens(1)
    expect(api.state.view).toBe('list')
  })

  it('shows a positive transfer gap on the lens', async () => {
    await boot({ routes: [route] })
    api.state.detailRoute = route
    api.state.detailTrips = [trip({ legs: [leg({ arrival: '2026-10-02T10:30:00Z' }), leg({ departure: '2026-10-02T10:35:00Z' })] })]
    api.state.detailStatus = 'ready'
    expect(api.detailContent()).toContain('Change (4 min)')
  })

  it('cleans up safely when refresh timers have not been assigned', async () => {
    await boot()
    vi.clearAllTimers()
    api.state.clockTimer = undefined
    api.state.tripsTimer = undefined
    api.cleanup()
    api.cleanup()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('journey presentation and stops', () => {
  it('formats modes, crowds, durations, missing times, icons, and platforms', async () => {
    await boot()
    expect(api.fmtTime('')).toBe('--:--')
    expect(api.fmtDuration(65)).toBe('1:05')
    expect(api.fmtDuration(70)).toBe('1:10')
    expect(api.legDurationText(5)).toBe('5 min')
    expect(api.legDurationText(65)).toBe('1:05 h')
    expect(api.legDurationText(70)).toBe('1:10 h')
    expect(api.platformBadge('')).toBe('')
    expect(api.platformBadge('2')).toContain('2')
    expect(api.delayTag(0)).toBe('')
    expect(api.delayTag(2)).toBe(' +2')
    expect(api.delayBadge(0)).toBe('')
    expect(api.stopTimeLine('', 0)).toBe('')
    expect(api.gapMinutes(leg({ arrival: '2026-10-02T10:00:00Z' }), leg({ departure: '2026-10-02T09:00:00Z' }))).toBe(0)
    expect(api.fmtDateHeader(new Date().toISOString())).toContain('Today,')
    expect(api.fmtDateHeader('2026-01-01T12:00:00Z')).not.toContain('Today')
    for (const [mode, label] of [['BUS', 'Bus'], ['TRAM', 'Tram'], ['METRO', 'Metro'], ['FERRY', 'Ferry'], ['WALK', 'Walk'], ['OTHER', '']]) {
      expect(api.modeLabel(mode)).toBe(label)
      expect(api.legBadgeLabel(leg({ mode: mode as TripLeg['mode'], category: '', displayName: '', service: '', trainNumber: '' }))).toBe(label || 'Train')
    }
    for (const crowd of ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']) {
      expect(api.crowdInline(crowd)).toContain('ctext--' + crowd.toLowerCase())
      expect(api.crowdBadge(crowd)).toEqual(crowd === 'UNKNOWN' ? '' : expect.stringContaining('crowd--' + crowd.toLowerCase()))
    }
    expect(api.legBadgeLabel(leg({ category: '' }))).toBe('Train')
    expect(api.serviceBadges([leg({ mode: 'WALK' }), leg({ mode: 'BUS', category: '', displayName: 'Bus' })])).toContain('Bus')
    expect(api.icon('unknown')).toBe('')
    expect(console.warn).toHaveBeenCalledWith('missing icon:', 'unknown')
    expect(api.icon('Guide System/Go')).toContain('width="18"')
    expect(api.icon('Guide System/Go', { size: 22, cls: 'muted', recolor: false })).toContain('class="icon muted"')
  })

  it('renders all trip-card variants and selects only the clicked card', async () => {
    await boot()
    const options = [trip({ cancelled: true, cancellationReason: 'Track work', legs: [] }), trip({ cancelled: true, legs: [leg({ mode: 'WALK' })] }), trip({ crowd: 'HIGH' })]
    api.state.detailRoute = route
    api.state.detailTrips = options
    api.renderTrips(options)
    expect(element('#results').querySelectorAll('.cancelled')).toHaveLength(2)
    expect(element('#results').textContent).toContain('Track work')
    click('#results .trip-card:nth-child(1)')
    click('#results .trip-card:nth-child(3)')
    expect(element('#results').querySelectorAll('.selected')).toHaveLength(1)
    expect(api.state.tripIdx).toBe(2)
    expect(api.buildSummary(options[0])).toContain('Cancelled — Track work')
    expect(api.buildSummary(options[1])).toContain('Cancelled')
    expect(api.buildDetail(options[0])).toContain('detail-title-main')
  })

  it('opens trip cards with Enter and Space without activating on other or nested keys', async () => {
    await boot()
    api.state.detailRoute = route
    api.state.detailTrips = [trip(), trip({ transfers: 1 })]
    api.renderTrips(api.state.detailTrips)
    const first = element('#results .trip-card')
    expect(first.getAttribute('role')).toBe('button')
    expect(first.tabIndex).toBe(0)
    first.focus()
    key('#results .trip-card', 'ArrowDown')
    key('#results .trip-card .trip-time', 'Enter')
    expect(element('#detail').hidden).toBe(true)
    key('#results .trip-card', 'Enter')
    expect(element('#detail').hidden).toBe(false)
    expect(document.activeElement).toBe(element('#detail-back'))
    expect(element('#app').hasAttribute('inert')).toBe(true)
    expect(api.state.tripIdx).toBe(0)
    element('.leg-service--tap').focus()
    key('.leg-service--tap', 'Tab')
    expect(document.activeElement).toBe(element('#detail-back'))
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    element('#detail-back').dispatchEvent(backwards)
    expect(document.activeElement).toBe(element('.leg-service--tap'))
    click('#detail-back')
    expect(document.activeElement).toBe(first)
    expect(element('#app').hasAttribute('inert')).toBe(false)
    element('#results .trip-card:nth-child(2)').focus()
    key('#results .trip-card:nth-child(2)', ' ')
    expect(api.state.tripIdx).toBe(1)
    expect(element('#results').querySelectorAll('.selected')).toHaveLength(1)
  })

  it('preserves focused detail controls on refresh and returns to a replacement trip card', async () => {
    await boot()
    const options = [trip({ legs: [leg({ stops: [] }), leg()] }), trip({ transfers: 1 })]
    api.state.detailRoute = route
    api.state.detailTrips = options
    api.renderTrips(options)
    element('#results .trip-card').focus()
    key('#results .trip-card', 'Enter')
    element('.leg-service--tap').focus()
    const oldLeg = document.activeElement
    element('#detail').scrollTop = 100
    api.renderTrips(options)
    api.showDetail(trip({ legs: [leg(), leg()] }), route)
    expect(document.activeElement).toBe(element('.leg-service--tap[data-leg="1"]'))
    expect(document.activeElement).not.toBe(oldLeg)
    expect(element('#detail').scrollTop).toBe(100)
    element('#from').focus()
    expect(document.activeElement).toBe(element('#detail-back'))
    const forwards = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    element('#detail-back').dispatchEvent(forwards)
    expect(forwards.defaultPrevented).toBe(false)
    element('.leg-service--tap').focus()
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    element('.leg-service--tap').dispatchEvent(backwards)
    expect(backwards.defaultPrevented).toBe(false)
    key('.leg-service--tap', 'Escape')
    expect(element('#detail').hidden).toBe(true)
    expect(document.activeElement).toBe(element('#results .trip-card'))
    expect(element('#app').hasAttribute('inert')).toBe(false)
  })

  it('keeps focus in stops through response and detail refreshes and restores its replacement leg', async () => {
    await boot()
    const itinerary = trip()
    const request = deferred<LegStop[]>()
    mocks.journey.mockReturnValueOnce(request.promise)
    api.state.detailRoute = route
    api.state.detailTrips = [itinerary]
    api.renderTrips([itinerary])
    const card = element('#results .trip-card')
    card.focus()
    key('#results .trip-card', 'Enter')
    element('.leg-service--tap').focus()
    key('.leg-service--tap', 'Enter')
    const oldBack = element('#stops-back')
    expect(document.activeElement).toBe(oldBack)
    expect(element('#detail').hasAttribute('inert')).toBe(true)
    key('#stops-back', 'Tab')
    expect(document.activeElement).toBe(oldBack)
    request.resolve([stop('Before'), stop(route.fromName), stop(route.toName)])
    await flush()
    const newBack = element('#stops-back')
    expect(document.activeElement).toBe(newBack)
    expect(newBack).not.toBe(oldBack)
    element('#detail').scrollTop = 100
    api.showDetail(itinerary, route, true)
    expect(element('#stops').hidden).toBe(false)
    expect(document.activeElement).toBe(newBack)
    expect(element('#detail').scrollTop).toBe(100)
    key('#stops-back', 'Escape')
    expect(element('#stops').hidden).toBe(true)
    expect(document.activeElement).toBe(element('.leg-service--tap'))
    expect(element('#detail').hasAttribute('inert')).toBe(false)
    expect(element('#app').hasAttribute('inert')).toBe(true)
    key('.leg-service--tap', 'Escape')
    expect(document.activeElement).toBe(card)
    expect(element('#app').hasAttribute('inert')).toBe(false)
  })

  it('keeps focus on a covering error when a stop response refreshes behind it', async () => {
    await boot()
    const request = deferred<LegStop[]>()
    mocks.journey.mockReturnValueOnce(request.promise)
    api.showDetail(trip())
    element('.leg-service--tap').focus()
    key('.leg-service--tap', 'Enter')
    api.showError('Offline')
    const ok = element('.modal-ok')
    request.resolve([stop(route.fromName), stop(route.toName)])
    await flush()
    expect(document.activeElement).toBe(ok)
    expect(element('#stops').hidden).toBe(false)
  })

  it('renders leg stops, transfer waits, changed operators, and walk-only routes', async () => {
    await boot()
    const first = leg({ operator: 'NS Rail', arrival: '2026-10-02T10:00:00Z', arrivalDelayMin: 0, walkToNextMin: 3 })
    const next = leg({ operator: 'Arriva Rail', departure: '2026-10-02T10:10:00Z', departureDelayMin: 0, originTrack: '9' })
    expect(api.transferBlock(first, next)).toContain('7 min')
    expect(api.transferBlock(first, next)).toContain('Check out/in: NS - Arriva')
    expect(api.transferBlock(first, next)).toContain('Walk to platform 9')
    expect(api.transferBlock({ ...first, walkToNextMin: 20 }, { ...next, operator: '', originTrack: '' })).not.toContain('Wait')
    expect(api.transferBlock({ ...first, walkToNextMin: null }, next)).toContain('10 min')
    expect(api.transferBlock(first, { ...next, operator: 'NS Rail' })).not.toContain('Check out/in')
    expect(api.transferBlock({ ...first, operator: '' }, next)).not.toContain('Check out/in')
    expect(api.legCard(leg({ stops: [], exitSide: '', intermediateStops: 2 }), 0)).not.toContain('leg-service--tap')
    expect(api.legCard(leg(), 0)).toContain('1 intermediate stop')
    const mixed = trip({ legs: [first, { ...next, mode: 'WALK' }] })
    expect(api.buildDetail(mixed)).toContain('xfer-row')
    expect(api.buildSummary(mixed)).toContain('gap-badge')
  })

  it('uses delayed arrivals and departures for every transfer display', async () => {
    await boot()
    const first = leg({ arrival: '2026-10-02T10:00:00Z', arrivalDelayMin: 8, walkToNextMin: 3 })
    const next = leg({ departure: '2026-10-02T10:10:00Z', departureDelayMin: 0 })
    const itinerary = trip({ legs: [first, next] })
    api.state.detailRoute = route
    api.state.detailTrips = [itinerary]
    api.state.detailStatus = 'ready'
    api.showDetail(itinerary)
    expect(api.gapMinutes(first, next)).toBe(2)
    expect(element('.gap-badge').textContent).toBe('2min')
    expect(api.detailContent()).toContain('Change (2 min)')
    expect(element('.xfer').textContent).toContain('3 min')
    expect(element('.xfer').textContent).not.toContain('Wait')
    expect(api.gapMinutes(first, { ...next, departureDelayMin: 12 })).toBe(14)
    expect(api.gapMinutes({ ...first, arrivalDelayMin: 15 }, next)).toBe(0)
    expect(api.gapMinutes({ ...first, arrival: '' }, next)).toBe(0)
    expect(api.gapMinutes(first, { ...next, departure: 'invalid' })).toBe(0)
    expect(api.gapMinutes({ ...first, arrival: '2026-10-02T23:59:00Z', arrivalDelayMin: 2 }, { ...next, departure: '2026-10-03T00:03:00Z' })).toBe(2)
    expect(api.gapMinutes({ ...first, arrival: '2026-10-02T10:10:00Z', arrivalDelayMin: 0 }, { ...next, departure: '2026-10-02T10:00:00Z', departureDelayMin: 15 })).toBe(5)
  })

  it('shows endpoint delays consistently in phone cards, summaries, and legs', async () => {
    await boot()
    const first = leg({ departureDelayMin: 5, arrivalDelayMin: 8 })
    const next = leg({ departureDelayMin: 0, arrivalDelayMin: 13 })
    const itinerary = trip({ legs: [first, next] })
    api.renderTrips([itinerary])
    api.showDetail(itinerary)
    expect(Array.from(document.querySelectorAll('#results .trip-time .delay'), (el) => el.textContent)).toEqual([' +5', ' +13'])
    expect(Array.from(document.querySelectorAll('#detail .summary .delay'), (el) => el.textContent)).toEqual([' +5', ' +13'])
    expect(Array.from(document.querySelectorAll('#detail .leg-time'), (el) => el.textContent)).toEqual([
      api.fmtTime(first.departure) + ' +5', api.fmtTime(first.arrival) + ' +8',
      api.fmtTime(next.departure), api.fmtTime(next.arrival) + ' +13',
    ])
    expect(api.tripDelays(trip({ legs: [] }))).toEqual({ departure: 0, arrival: 0 })
  })

  it('keeps bus line identifiers on phone cards, details, stops, and the lens', async () => {
    await boot()
    const bus = leg({ mode: 'BUS', category: 'BUS', displayName: 'Bus', service: 'Bus 320', trainNumber: '320' })
    const itinerary = trip({ legs: [bus] })
    api.state.detailRoute = route
    api.state.detailTrips = [itinerary]
    api.state.detailStatus = 'ready'
    api.renderTrips([itinerary])
    api.showDetail(itinerary)
    expect(element('#results .badge').textContent?.trim()).toBe('Bus 320')
    expect(element('#detail .badge').textContent?.trim()).toBe('Bus 320')
    expect(element('.leg-service-name').textContent).toBe('Bus 320')
    expect(api.buildStops(bus, bus.stops, 0, 2)).toContain('Bus 320')
    expect(api.detailContent()).toContain('Bus 320 · Trip:')
    expect(api.legServiceLabel({ ...bus, displayName: 'Bus 320' })).toBe('Bus 320')
    expect(api.legServiceLabel({ ...bus, displayName: '', trainNumber: '' })).toBe('Bus 320')
    expect(api.legServiceLabel({ ...bus, trainNumber: '' })).toBe('Bus 320')
    expect(api.legServiceLabel({ ...bus, trainNumber: '', service: '' })).toBe('Bus')
    expect(api.legServiceLabel({ ...bus, trainNumber: '', service: '', displayName: '' })).toBe('Bus')
    expect(api.legServiceLabel(leg({ trainNumber: '', service: '', displayName: '' }))).toBe('Train')
    expect(api.legServiceLabel(leg({ trainNumber: '', service: 'IC', displayName: 'Intercity' }))).toBe('Intercity')
  })

  it('shows explicit walking legs once and preserves positive waits beside them', async () => {
    await boot()
    const first = leg({ arrival: '2026-10-02T10:00:00Z', arrivalDelayMin: 0, operator: '' })
    const walk = leg({ mode: 'WALK', category: 'WALK', displayName: 'Walking', service: 'Walk', trainNumber: '', operator: '', stops: [], departure: first.arrival, departureDelayMin: 0, arrival: '2026-10-02T10:03:00Z', arrivalDelayMin: 0, durationMin: 3 })
    const next = leg({ departure: walk.arrival, departureDelayMin: 0, operator: '' })
    const itinerary = trip({ legs: [first, walk, next] })
    api.state.detailRoute = route
    api.state.detailTrips = [itinerary]
    api.state.detailStatus = 'ready'
    api.showDetail(itinerary)
    expect(Array.from(document.querySelectorAll('#detail .badge'), (el) => el.textContent?.trim())).toEqual(['IC', 'Walk 3 min', 'IC'])
    expect(document.querySelector('#detail .gap-badge')).toBeNull()
    expect(document.querySelector('#detail .xfer-row')).toBeNull()
    expect(api.detailContent()).toContain('Walk · Trip: 3 min')
    expect(api.detailContent()).not.toContain('Change (0 min)')
    const waitingWalk = { ...walk, departure: '2026-10-02T10:02:00Z', arrival: '2026-10-02T10:05:00Z' }
    const waitingTrip = trip({ legs: [first, waitingWalk, { ...next, departure: '2026-10-02T10:10:00Z' }] })
    api.state.detailTrips = [waitingTrip]
    api.showDetail(waitingTrip)
    expect(Array.from(document.querySelectorAll('#detail .gap-badge'), (el) => el.textContent)).toEqual(['2min', '5min'])
    expect(Array.from(document.querySelectorAll('#detail .xfer-text'), (el) => el.textContent)).toEqual(['Wait', 'Wait'])
    expect(Array.from(document.querySelectorAll('#detail .xfer-left'), (el) => el.textContent)).toEqual(['2 min', '5 min'])
    expect(api.detailContent()).toContain('Wait (2 min)')
    expect(api.detailContent()).toContain('Wait (5 min)')
  })

  it('carries an incoming delay through walking times and later connection gaps', async () => {
    await boot()
    const first = leg({ arrival: '2026-10-02T10:00:00Z', arrivalDelayMin: 8, operator: '' })
    const walk = leg({ mode: 'WALK', departure: first.arrival, departureDelayMin: 0, arrival: '2026-10-02T10:03:00Z', arrivalDelayMin: 0, durationMin: 3, operator: '', trainNumber: '', stops: [] })
    const next = leg({ departure: '2026-10-02T10:10:00Z', departureDelayMin: 0, operator: '' })
    const itinerary = trip({ legs: [first, walk, next] })
    api.state.detailRoute = route
    api.state.detailStatus = 'ready'
    api.state.detailTrips = [itinerary]
    api.showDetail(itinerary)
    const walkingTimes = document.querySelectorAll('#detail .leg')[1].querySelectorAll('.leg-time')
    expect(Array.from(walkingTimes, (el) => el.textContent)).toEqual([api.fmtTime(walk.departure) + ' +8', api.fmtTime(walk.arrival) + ' +8'])
    expect(document.querySelector('#detail .gap-badge')).toBeNull()
    expect(document.querySelector('#detail .xfer-row')).toBeNull()
    expect(api.detailContent()).toContain(api.fmtTime(walk.arrival) + ' +8')
    expect(api.detailContent()).not.toContain('Wait')
    expect(walk.departureDelayMin).toBe(0)
    expect(walk.arrivalDelayMin).toBe(0)
    const feasible = trip({ legs: [{ ...first, arrivalDelayMin: 5 }, walk, next] })
    api.state.detailTrips = [feasible]
    api.showDetail(feasible)
    expect(element('#detail .gap-badge').textContent).toBe('2min')
    expect(element('#detail .xfer-left').textContent).toBe('2 min')
    expect(element('#detail .xfer-text').textContent).toBe('Wait')
    expect(api.detailContent()).toContain('Wait (2 min)')
    const endingWalk = trip({ legs: [first, walk], arrival: walk.arrival })
    api.state.detailTrips = [endingWalk]
    api.renderTrips([endingWalk])
    api.showDetail(endingWalk)
    expect(api.tripDelays(endingWalk).arrival).toBe(8)
    expect(element('#results .trip-time').textContent).toContain(api.fmtTime(walk.arrival) + ' +8')
    expect(element('#detail .summary .trip-time').textContent).toContain(api.fmtTime(walk.arrival) + ' +8')
    expect(api.listContent()).toContain(api.fmtTime(walk.arrival) + ' +8')
    expect(api.detailContent()).toContain('ETA: ' + api.fmtTime(walk.arrival) + ' +8')
  })

  it('propagates walking delays across midnight and consecutive legs without accumulating them twice', async () => {
    await boot()
    const first = leg({ arrival: '2026-10-02T23:59:00Z', arrivalDelayMin: 8 })
    const walk = leg({ mode: 'WALK', departure: first.arrival, departureDelayMin: 2, arrival: '2026-10-03T00:02:00Z', arrivalDelayMin: 2, durationMin: 3 })
    const secondWalk = { ...walk, departure: walk.arrival, departureDelayMin: 0, arrival: '2026-10-03T00:06:00Z', arrivalDelayMin: 0, durationMin: 4 }
    const next = leg({ departure: '2026-10-03T00:17:00Z', departureDelayMin: 0 })
    const effective = api.effectiveLegs([first, walk, secondWalk, next])
    expect(effective[0]).toBe(first)
    expect(effective[3]).toBe(next)
    expect(effective.slice(1, 3).map((item: TripLeg) => [item.departureDelayMin, item.arrivalDelayMin])).toEqual([[8, 8], [8, 8]])
    expect(api.gapMinutes(effective[2], effective[3])).toBe(3)
    expect(api.effectiveLegs(effective)).toEqual(effective)
    expect(api.effectiveLegs([{ ...first, arrival: '' }, walk])[1]).toBe(walk)
    const alreadyDelayed = { ...walk, departureDelayMin: 9, arrivalDelayMin: 9 }
    expect(api.effectiveLegs([first, alreadyDelayed])[1]).toBe(alreadyDelayed)
  })

  it('retains numbered API service names when product numbers are absent', async () => {
    await boot()
    for (const service of [
      leg({ mode: 'BUS', displayName: 'Lijnbus', service: 'Bus 320', trainNumber: '' }),
      leg({ displayName: 'Intercity', service: 'IC 1429', trainNumber: '' }),
    ]) {
      const itinerary = trip({ legs: [service] })
      api.state.detailRoute = route
      api.state.detailTrips = [itinerary]
      api.state.detailStatus = 'ready'
      api.showDetail(itinerary)
      expect(element('.leg-service-name').textContent).toBe(service.service)
      expect(api.buildStops(service, service.stops, 0, 2)).toContain(service.service)
      expect(api.detailContent()).toContain(service.service + ' · Trip:')
    }
  })

  it('labels unknown walking time honestly and omits empty transfer rows', async () => {
    await boot()
    const first = leg({ arrival: '2026-10-02T10:00:00Z', arrivalDelayMin: 0, walkToNextMin: null })
    const next = leg({ departure: '2026-10-02T10:10:00Z', departureDelayMin: 0 })
    const transfer = api.transferBlock(first, next)
    expect(transfer).toContain('10 min')
    expect(transfer).toContain('Transfer time')
    expect(transfer).not.toContain('Walk to')
    expect(transfer).not.toContain('Wait')
    expect(api.transferBlock(first, { ...next, departure: first.arrival })).toBe('')
    expect(api.transferBlock({ ...first, walkToNextMin: 0 }, { ...next, departure: first.arrival })).toBe('')
    expect(api.transferBlock({ ...first, walkToNextMin: 0 }, next)).toContain('Wait')
    expect(api.transferBlock({ ...first, mode: 'WALK' }, { ...next, departure: first.arrival, operator: 'Arriva' })).toContain('Check out/in')
  })

  it('marks cancelled legs and individual stops without boarding instructions', async () => {
    await boot()
    const cancelledLeg = leg({ cancelled: true, trainNumber: '' })
    const itinerary = trip({ legs: [cancelledLeg], cancelled: true })
    api.state.detailRoute = route
    api.state.detailTrips = [itinerary]
    api.state.detailStatus = 'ready'
    api.showDetail(itinerary)
    expect(element('.leg.cancelled .leg-service-meta').textContent).toBe('Cancelled')
    expect(api.detailContent()).toContain('IC 123 · CANCELLED')
    api.showStops(cancelledLeg)
    expect(document.querySelectorAll('#stops .stop.cancelled')).toHaveLength(3)
    expect(element('#stops').textContent).not.toContain('Board here')
    expect(element('#stops').textContent).not.toContain('Get off here')
    expect(element('#stops .leg-cancelled').textContent).toBe('Cancelled')
    for (const index of [0, 1, 2]) {
      const html = api.stopRow(stop('Skipped stop', { cancelled: true }), index, 3, 0, 2)
      expect(html).toContain('class="stop cancelled"')
      expect(html).toContain('Cancelled')
      expect(html).not.toContain('Board here')
      expect(html).not.toContain('Get off here')
    }
    expect(api.stopRow(stop('Running stop'), 1, 3, 0, 2)).not.toContain('Cancelled')
  })

  it('limits leg cancellation to the travelled segment of a fetched full route', async () => {
    await boot()
    const cancelledLeg = leg({ cancelled: true, origin: 'B', destination: 'D', stops: [stop('B'), stop('C'), stop('D')] })
    const full = ['A', 'B', 'C', 'D', 'E'].map((name) => stop(name))
    mocks.journey.mockResolvedValueOnce(full)
    api.showStops(cancelledLeg)
    await flush()
    expect(Array.from(document.querySelectorAll('#stops .stop.cancelled .stop-name'), (el) => el.textContent)).toEqual(['B', 'C', 'D'])
    expect(element('#stops').textContent).not.toContain('Board here')
    expect(element('#stops').textContent).not.toContain('Get off here')
    mocks.journey.mockResolvedValueOnce([{ ...full[0], cancelled: true }, ...full.slice(1)])
    api.showStops(cancelledLeg)
    await flush()
    expect(Array.from(document.querySelectorAll('#stops .stop.cancelled .stop-name'), (el) => el.textContent)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('localizes walking, durations, exit sides, transfer time, and cancellations', async () => {
    await boot({ lang: 'nl' })
    expect(api.legDurationText(65)).toBe('1:05 u')
    expect(api.legDurationText(3)).toBe('3 min')
    expect(api.legCard(leg({ exitSide: 'LEFT' }), 0)).toContain('Uitstapzijde links')
    expect(api.legCard(leg({ exitSide: 'right' }), 0)).toContain('Uitstapzijde rechts')
    expect(api.exitSideText('UNKNOWN')).toBe('unknown')
    expect(api.serviceBadges([leg({ mode: 'WALK', durationMin: 3 })])).toContain('Lopen 3 min')
    const first = leg({ arrival: '2026-10-02T10:00:00Z', arrivalDelayMin: 0, walkToNextMin: null })
    const next = leg({ departure: '2026-10-02T10:10:00Z', departureDelayMin: 0 })
    expect(api.transferBlock(first, next)).toContain('Overstaptijd')
    expect(api.transferBlock({ ...first, mode: 'WALK' }, next)).toContain('Wachten')
    expect(api.buildSummary(trip({ cancelled: true }))).toContain('Geannuleerd')
    expect(api.legCard(leg({ cancelled: true }), 0)).toContain('Geannuleerd')
    expect(api.stopRow(stop('Skipped stop', { cancelled: true }), 0, 1, 0, 0)).toContain('Geannuleerd')
    api.state.detailRoute = route
    api.state.detailStatus = 'ready'
    api.state.detailTrips = [trip({ cancelled: true, legs: [leg({ cancelled: true })] })]
    expect(api.listContent()).toContain('GEANNULEERD')
    expect(api.detailContent()).toContain('Intercity 123 · GEANNULEERD')
    api.state.detailTrips = [trip({ durationMin: 65 })]
    expect(api.listContent()).toContain('1:05u')
  })

  it('opens stops by click and keyboard, fetches the full route, and marks the travel segment', async () => {
    await boot()
    const full = [stop('Before'), stop(route.fromName), stop('Intermediate'), stop(route.toName), stop('After')]
    mocks.journey.mockResolvedValue(full)
    const itinerary = trip()
    api.state.detailRoute = route
    api.state.detailTrips = [itinerary]
    api.showDetail(itinerary)
    click('.leg-service--tap')
    await flush()
    expect(mocks.journey).toHaveBeenCalledWith('123', { dateTime: itinerary.departure, lang: 'en' })
    expect(element('#stops').textContent).toContain('Before')
    expect(element('#stops').textContent).toContain('Board here')
    expect(element('#stops').textContent).toContain('Get off here')
    expect(element('#stops').innerHTML).toContain('stop-name--muted')
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    click('#stops-back')
    expect(element('#stops').hidden).toBe(true)
    key('.leg-service--tap', 'x')
    expect(element('#stops').hidden).toBe(true)
    key('.leg-service--tap', 'Enter')
    await flush()
    click('#stops-back')
    key('.leg-service--tap', ' ')
    await flush()
    expect(element('#stops').hidden).toBe(false)
  })

  it('keeps partial stop lists for missing train numbers, empty or invalid full routes, and failures', async () => {
    await boot()
    api.showStops(undefined)
    api.showStops(leg({ stops: [] }))
    expect(element('#stops').hidden).toBe(true)
    api.showStops(leg({ trainNumber: '' }))
    expect(mocks.journey).not.toHaveBeenCalled()
    for (const full of [[], [stop('Unknown'), stop(route.toName)], [stop(route.fromName), stop('Unknown')], [stop(route.toName), stop(route.fromName)]]) {
      mocks.journey.mockResolvedValueOnce(full)
      api.showStops(leg())
      await flush()
      expect(element('#stops .stops-list').children).toHaveLength(3)
    }
    mocks.journey.mockRejectedValueOnce(new Error('offline'))
    api.showStops(leg())
    await flush()
    expect(console.error).toHaveBeenCalledWith('fetchJourney failed:', expect.any(Error))
    mocks.journey.mockResolvedValueOnce([stop(route.fromName), stop(route.toName)])
    api.showStops(leg())
    await flush()
    expect(element('#stops .stops-list').children).toHaveLength(2)
  })

  it('ignores stale or closed stop requests', async () => {
    await boot()
    const first = deferred<LegStop[]>()
    mocks.journey.mockReturnValueOnce(first.promise)
    api.showStops(leg())
    api.showStops(leg({ trainNumber: '' }))
    first.resolve([stop('Old'), stop(route.fromName), stop(route.toName)])
    await flush()
    expect(element('#stops').textContent).not.toContain('Old')
    const second = deferred<LegStop[]>()
    mocks.journey.mockReturnValueOnce(second.promise)
    api.showStops(leg())
    click('#stops-back')
    second.resolve([stop('Old'), stop(route.fromName), stop(route.toName)])
    await flush()
    expect(element('#stops').textContent).not.toContain('Old')
  })
})

describe('time picker', () => {
  it('moves focus into the modal, traps Tab, blocks background focus, and restores focus on Escape', async () => {
    await boot()
    const preserved = document.createElement('div')
    preserved.setAttribute('inert', '')
    document.body.appendChild(preserved)
    const opener = element('#dep-box')
    opener.focus()
    click('#dep-box')
    expect(document.activeElement).toBe(element('#tab-dep'))
    expect(element('#app').hasAttribute('inert')).toBe(true)
    expect(element('#time-modal').hasAttribute('inert')).toBe(false)
    api.openTimeModal()
    element('#from').focus()
    expect(document.activeElement).toBe(element('#tab-dep'))
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    element('#tab-dep').dispatchEvent(backwards)
    expect(backwards.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(element('#time-done'))
    key('#time-done', 'Tab')
    expect(document.activeElement).toBe(element('#tab-dep'))
    const forwards = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    element('#tab-dep').dispatchEvent(forwards)
    expect(forwards.defaultPrevented).toBe(false)
    element('#wheel-min').focus()
    const interiorBack = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    element('#wheel-min').dispatchEvent(interiorBack)
    expect(interiorBack.defaultPrevented).toBe(false)
    key('#wheel-min', 'Escape')
    expect(element('#time-modal').hidden).toBe(true)
    expect(element('#app').hasAttribute('inert')).toBe(false)
    expect(preserved.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(opener)
    expect(api.state.planDateTime).toBeNull()
    expect(api.state.timeBackground).toEqual([])
  })

  it('restores focus on cancellation and completion, and recovers when the original focus target is removed', async () => {
    await boot()
    click('#dep-box')
    click('#time-cancel')
    expect(document.activeElement).toBe(element('#dep-box'))
    const previous = document.createElement('button')
    document.body.appendChild(previous)
    previous.focus()
    api.openTimeModal()
    previous.remove()
    click('#time-cancel')
    expect(document.activeElement).toBe(element('#dep-box'))
    api.state.planTimeMode = 'arrival'
    click('#dep-box')
    expect(document.activeElement).toBe(element('#tab-arr'))
    expect(element('#tab-arr').getAttribute('aria-pressed')).toBe('true')
    expect(element('#tab-dep').getAttribute('aria-pressed')).toBe('false')
    click('#time-done')
    expect(document.activeElement).toBe(element('#dep-box'))
  })

  it('selects hour and minute values with keyboard arrows and boundaries', async () => {
    await boot()
    click('#dep-box')
    const hour = element('#wheel-hour')
    const minute = element('#wheel-min')
    expect(hour.getAttribute('role')).toBe('spinbutton')
    expect(hour.tabIndex).toBe(0)
    expect(hour.getAttribute('aria-valuemin')).toBe('0')
    expect(hour.getAttribute('aria-valuemax')).toBe('23')
    expect(minute.getAttribute('aria-valuemax')).toBe('59')
    hour.focus()
    key('#wheel-hour', 'Home')
    key('#wheel-hour', 'ArrowDown')
    expect(api.state.hourWheel.get()).toBe(0)
    key('#wheel-hour', 'End')
    key('#wheel-hour', 'ArrowUp')
    expect(api.state.hourWheel.get()).toBe(23)
    key('#wheel-hour', 'ArrowDown')
    expect(hour.getAttribute('aria-valuenow')).toBe('22')
    key('#wheel-min', 'Home')
    key('#wheel-min', 'ArrowUp')
    key('#wheel-min', 'x')
    expect(minute.getAttribute('aria-valuenow')).toBe('1')
    expect(minute.querySelector('.sel')!.textContent).toBe('01')
    expect(element('#time-now').getAttribute('aria-pressed')).toBe('false')
    click('#time-done')
    expect(api.state.planDateTime.getHours()).toBe(22)
    expect(api.state.planDateTime.getMinutes()).toBe(1)
  })

  it('commits scroll-only changes and retains Now after programmatic wheel positioning', async () => {
    await boot()
    click('#dep-box')
    const minute = element('#wheel-min')
    minute.dispatchEvent(new Event('scroll'))
    expect(api.state.pickerIsNow).toBe(true)
    minute.scrollTop = 56 * 25
    minute.dispatchEvent(new Event('scroll'))
    expect(api.state.pickerIsNow).toBe(false)
    click('#time-done')
    expect(api.state.planDateTime.getMinutes()).toBe(25)
    click('#dep-box')
    click('#time-now')
    element('#wheel-hour').dispatchEvent(new Event('scroll'))
    minute.dispatchEvent(new Event('scroll'))
    expect(api.state.pickerIsNow).toBe(true)
    expect(element('#time-now').getAttribute('aria-pressed')).toBe('true')
    click('#time-done')
    expect(api.state.planDateTime).toBeNull()
  })

  it('formats today, tomorrow, yesterday, and other days', async () => {
    await boot()
    const now = new Date()
    expect(api.dayLabel(now)).toBe('Today')
    expect(api.dayLabel(new Date(now.getTime() + 86400000))).toBe('Tomorrow')
    expect(api.dayLabel(new Date(now.getTime() - 86400000))).toBe('Yesterday')
    expect(api.dayLabel(new Date(now.getTime() + 86400000 * 3))).not.toMatch(/Today|Tomorrow|Yesterday/)
  })

  it.each([
    { now: '2026-03-29T12:00:00+02:00', today: '2026-03-29T00:00:00+01:00', tomorrow: '2026-03-30T00:00:00+02:00', afterTomorrow: '2026-03-31T00:00:00+02:00', offset: -120 },
    { now: '2026-10-25T12:00:00+01:00', today: '2026-10-25T00:00:00+02:00', tomorrow: '2026-10-26T00:00:00+01:00', afterTomorrow: '2026-10-27T00:00:00+01:00', offset: -60 },
  ])('moves calendar days across Amsterdam DST on $now', async ({ now, today, tomorrow, afterTomorrow, offset }) => {
    vi.stubEnv('TZ', 'Europe/Amsterdam')
    try {
      vi.setSystemTime(new Date(now))
      await boot()
      expect(new Date().getTimezoneOffset()).toBe(offset)
      click('#dep-box')
      expect(api.state.pickerDate.getTime()).toBe(new Date(today).getTime())
      click('#date-next')
      expect(api.state.pickerDate.getTime()).toBe(new Date(tomorrow).getTime())
      expect(element('#date-label').textContent).toBe('Tomorrow')
      expect(element<HTMLButtonElement>('#date-prev').disabled).toBe(false)
      click('#date-next')
      expect(api.state.pickerDate.getTime()).toBe(new Date(afterTomorrow).getTime())
      click('#date-prev')
      expect(api.state.pickerDate.getTime()).toBe(new Date(tomorrow).getTime())
      click('#date-prev')
      expect(api.state.pickerDate.getTime()).toBe(new Date(today).getTime())
      expect(element('#date-label').textContent).toBe('Today')
      expect(element<HTMLButtonElement>('#date-prev').disabled).toBe(true)
      click('#date-prev')
      expect(api.state.pickerDate.getTime()).toBe(new Date(today).getTime())
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each(['default', 'now'])('uses fresh timestamps for arrival searches with %s time', async (selection) => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    click('#dep-box')
    click('#tab-arr')
    if (selection === 'now') {
      click('#date-next')
      api.state.hourWheel.set(8)
      api.state.minWheel.set(5)
      click('#time-now')
    }
    click('#time-done')
    await flush()
    expect(element('#dep-label').textContent).toBe('Arrival:')
    expect(element('#dep-value').textContent).toBe(' now')
    expect(api.state.planDateTime).toBeNull()
    expect(mocks.trips).toHaveBeenLastCalledWith(route.fromCode, route.toCode, {
      lang: 'en', dateTime: '2026-10-02T10:15:00.000Z', searchForArrival: true,
    })
    vi.setSystemTime(new Date('2026-10-02T10:35:00Z'))
    await api.refreshOpenTrips()
    expect(mocks.trips).toHaveBeenLastCalledWith(route.fromCode, route.toCode, {
      lang: 'en', dateTime: '2026-10-02T10:35:00.000Z', searchForArrival: true,
    })
    const requestCount = mocks.trips.mock.calls.length
    click('#dep-box')
    click('#tab-dep')
    click('#date-next')
    api.state.hourWheel.set(8)
    click('#time-cancel')
    expect(api.state.planTimeMode).toBe('arrival')
    expect(api.state.planDateTime).toBeNull()
    expect(mocks.trips).toHaveBeenCalledTimes(requestCount)
    vi.setSystemTime(new Date('2026-10-02T10:45:00Z'))
    expect(api.tripOpts()).toEqual({
      lang: 'en', dateTime: '2026-10-02T10:45:00.000Z', searchForArrival: true,
    })
    click('#dep-box')
    expect(api.state.pickerMode).toBe('arrival')
    expect(api.state.pickerIsNow).toBe(true)
  })

  it('selects arrival/departure, days and wheel values, commits, reopens, and resets to now', async () => {
    await boot()
    click('#dep-box')
    expect(element('#time-modal').hidden).toBe(false)
    expect(element<HTMLButtonElement>('#date-prev').disabled).toBe(true)
    api.state.datePrev.dispatchEvent(new MouseEvent('click'))
    expect(element('#date-label').textContent).toBe('Today')
    click('#tab-arr')
    click('#date-next')
    expect(element('#date-label').textContent).toBe('Tomorrow')
    click('#date-prev')
    click('#date-next')
    api.state.hourWheel.set(8)
    api.state.minWheel.set(5)
    click('#time-done')
    expect(element('#dep-label').textContent).toBe('Arrival:')
    expect(element('#dep-value').textContent).toContain('Tomorrow 08:05')
    expect(api.tripOpts()).toMatchObject({ searchForArrival: true, dateTime: expect.any(String) })
    click('#dep-box')
    expect(api.state.hourWheel.get()).toBe(8)
    expect(api.state.minWheel.get()).toBe(5)
    click('#tab-dep')
    click('#time-now')
    click('#time-done')
    expect(api.tripOpts()).toEqual({ lang: 'en' })
    expect(element('#dep-value').textContent).toBe(' now')
    click('#dep-box')
    click('.time-card')
    expect(element('#time-modal').hidden).toBe(false)
    click('#time-modal')
    expect(element('#time-modal').hidden).toBe(true)
    click('#dep-box')
    click('#time-cancel')
    expect(element('#time-modal').hidden).toBe(true)
  })

  it('clamps wheel indices and marks selected values after scrolling and touch input', async () => {
    await boot()
    click('#dep-box')
    api.state.hourWheel.set(-1)
    expect(api.state.hourWheel.get()).toBe(0)
    api.state.hourWheel.set(100)
    expect(api.state.hourWheel.get()).toBe(23)
    const wheel = element('#wheel-min')
    wheel.scrollTop = 56 * 12
    wheel.dispatchEvent(new Event('scroll'))
    expect(api.state.minWheel.get()).toBe(12)
    expect(wheel.querySelector('.sel')!.textContent).toBe('12')
    for (const event of ['pointerdown', 'wheel', 'touchstart']) wheel.dispatchEvent(new Event(event))
    expect(api.state.pickerIsNow).toBe(false)
    wheel.scrollTop = -56
    expect(api.state.minWheel.get()).toBe(0)
    wheel.scrollTop = 10000
    expect(api.state.minWheel.get()).toBe(59)
  })

  it('replans existing phone results and an open glasses board when time is committed', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    click('#dep-box')
    click('#time-done')
    await flush()
    expect(mocks.trips).toHaveBeenCalledTimes(2)
    api.setResults('')
    click('#dep-box')
    click('#time-done')
    await flush()
    expect(mocks.trips).toHaveBeenCalledTimes(3)
  })
})

describe('defensive UI boundaries', () => {
  it.each(['from', 'to'])('handles a missing %s field', async (missing) => {
    await boot({ missingIds: [missing] })
    const calls = mocks.trips.mock.calls.length
    click('#swap')
    await api.planJourney()
    api.selectSavedRoute(route)
    api.useFavorite({ code: 'UT', name: 'Utrecht' })
    click('#clear-search')
    expect(mocks.trips.mock.calls.length).toBe(calls)
    expect(api.state.view).toBe('home')
  })

  it('handles missing optional planner elements without crashing', async () => {
    await boot({ missingIds: ['swap', 'from-list', 'to-list', 'fav-input', 'fav-list-dropdown', 'results', 'dep-label', 'dep-value', 'plan', 'clear-search', 'fav-add', 'dep-box', 'saved', 'fav-list', 'home-sections', 'lang-menu', 'lang-toggle'] })
    api.setResults('ignored')
    api.renderTrips([trip()])
    api.renderSavedRoutes()
    api.renderFavorites()
    api.renderLangMenu()
    api.closeLangMenu()
    api.showPlanAgain(true)
    api.updateDepBox()
    api.localizeStatic()
    api.setText('absent', 'text')
    api.setPlaceholder('absent', 'text')
    api.setAria('absent', 'text')
    api.commitTime()
    await api.addFavoriteFromInput()
    expect(api.state.results).toBeNull()
    expect(api.state.langMenu).toBeNull()
  })

  it('handles missing optional modal controls and boarding marker', async () => {
    await boot({ favorites: [{ code: 'UT', name: 'Utrecht' }], missingSelectors: ['#detail-back', '#stops-back', '#stop-board', '.modal-ok', '#time-cancel', '#time-done', '#fav-back', '#fav-name-clear', '#fav-save', '#fav-remove'] })
    api.showError('Failure')
    api.localizeStatic()
    api.showFavEdit(0)
    api.showDetail(trip())
    mocks.journey.mockResolvedValueOnce([stop('Before'), stop(route.fromName), stop(route.toName)])
    api.showStops(leg())
    await flush()
    expect(element('#stops .stops-list').children).toHaveLength(3)
    expect(api.state.errorModalText.textContent).toBe('Failure')
  })

  it('handles a favorite name field removed after opening the editor', async () => {
    await boot({ favorites: [{ code: 'UT', name: 'Utrecht' }] })
    api.showFavEdit(0)
    element('#fav-name').remove()
    click('#fav-name-clear')
    click('#fav-save')
    expect(api.state.favorites[0].label).toBe('Utrecht')
  })

  it('ignores missing legs in dynamically replaced detail markup', async () => {
    await boot()
    const invalid = document.createElement('div')
    invalid.dataset.leg = '99'
    const original = api.state.detailView.querySelectorAll.bind(api.state.detailView)
    vi.spyOn(api.state.detailView, 'querySelectorAll').mockImplementation((selector: unknown) => selector === '.leg-service--tap' ? [invalid] : original(selector))
    api.showDetail(trip())
    expect(element('#detail').hidden).toBe(false)
    expect(element('#stops').hidden).toBe(true)
    click('#detail-back')
    expect(element('#detail').hidden).toBe(true)
    expect(api.state.view).toBe('home')
  })

  it('keeps a phone overlay keyboard reachable when its optional controls disappear', async () => {
    await boot()
    api.showStops(leg({ trainNumber: '' }))
    element('#stops-back').remove()
    element('#from').focus()
    expect(document.activeElement).toBe(element('#stops'))
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    element('#stops').dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(element('#stops'))
    key('#stops', 'Escape')
    expect(element('#stops').hidden).toBe(true)
    expect(element('#app').hasAttribute('inert')).toBe(false)
  })

  it('clamps a stale journey selection before opening and a stale detail selection before rendering', async () => {
    await boot({ routes: [route] })
    api.state.journeyIdx = 999
    await api.openTripList()
    expect(api.state.detailRoute).toEqual(route)
    api.state.tripIdx = 999
    expect(api.detailContent()).toContain('ETA:')
    expect(api.state.tripIdx).toBe(0)
  })

  it('ignores refreshed trips when the view changes without changing the route', async () => {
    await boot({ routes: [route] })
    await api.openTripList()
    const original = api.state.detailTrips
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    const refresh = api.refreshOpenTrips()
    api.state.view = 'home'
    pending.resolve([trip({ durationMin: 99 })])
    await refresh
    expect(api.state.detailTrips).toBe(original)
  })
})

describe('SDK rendering failures', () => {
  async function renderingFailure(action: () => unknown) {
    const error = new Error('display disconnected')
    mocks.bridge.textContainerUpgrade.mockRejectedValueOnce(error)
    action()
    await flush()
    expect(console.error).toHaveBeenCalledWith(error)
    const calls = mocks.bridge.textContainerUpgrade.mock.calls.length
    await api.renderLens()
    expect(mocks.bridge.textContainerUpgrade).toHaveBeenCalledTimes(calls + 1)
    vi.mocked(console.error).mockClear()
  }

  it('reports navigation, mirroring, localization, and clock rendering failures', async () => {
    await boot({ routes: [route] })
    await renderingFailure(() => api.removeRoute(route.fromCode, route.toCode))
    api.addRoute(route)
    await flush()
    await renderingFailure(() => api.cycleJourney(1))
    api.state.detailRoute = route
    api.state.detailTrips = [trip()]
    api.state.detailStatus = 'ready'
    await renderingFailure(() => api.openTripDetail())
    await renderingFailure(() => api.cycleTrip(1))
    api.state.view = 'list'
    await renderingFailure(() => api.goBack())
    await renderingFailure(() => gesture(OsEventTypeList.CLICK_EVENT, true))
    await renderingFailure(() => api.mirrorHomeToLens())
    api.state.detailRoute = route
    api.state.detailTrips = [trip()]
    await renderingFailure(() => api.mirrorDetailToLens(0))
    await renderingFailure(() => api.applyLanguage())
    await renderingFailure(() => {
      api.state.view = 'detail'
      api.showDetail(trip(), route)
      click('#detail-back')
    })
    mocks.bridge.textContainerUpgrade.mockRejectedValueOnce(new Error('clock unavailable'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'clock unavailable' }))
  })

  it('recovers the final glasses list after a failed result draw', async () => {
    await boot({ routes: [route] })
    const error = new Error('result draw unavailable')
    mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(true).mockRejectedValueOnce(error)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(console.error).toHaveBeenCalledWith(error)
    expect(mocks.trips).toHaveBeenCalledOnce()
    expect(api.state.detailStatus).toBe('ready')
    await vi.advanceTimersByTimeAsync(10000)
    expect(lens()).toContain('Utrecht Centraal > Amsterdam Centraal')
    expect(lens()).not.toContain('Loading times...')
  })

  it('reports refresh rendering failure', async () => {
    await boot({ routes: [route] })
    await api.openTripList()
    await vi.advanceTimersByTimeAsync(50000)
    mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('refresh unavailable'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'refresh unavailable' }))
    expect(console.error).toHaveBeenCalledOnce()
    const calls = mocks.bridge.textContainerUpgrade.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(mocks.bridge.textContainerUpgrade).toHaveBeenCalledTimes(calls + 1)
  })

  it('reports initial, success, and error lens rendering failures during phone planning', async () => {
    await boot()
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    await flush()
    await renderingFailure(() => api.planJourney())
    mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('result display unavailable'))
    await api.planJourney()
    await flush()
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'result display unavailable' }))
    mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('error display unavailable'))
    mocks.trips.mockRejectedValueOnce(new Error('offline'))
    await api.planJourney()
    await flush()
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'error display unavailable' }))
  })

  it('reports failed actions from plan, saved-route, and time-picker handlers', async () => {
    await boot({ routes: [route] })
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!.set!
    const setter = vi.spyOn(api.state.results, 'innerHTML', 'set')
    const error = new Error('view unavailable')
    for (const action of [() => click('#plan'), () => api.selectSavedRoute(route), () => { api.setResults('<p>Existing results</p>'); api.commitTime() }]) {
      api.state.phoneRoute = route
      setter.mockImplementationOnce(function (this: Element, value: string) {
        if (value.includes('Existing results')) {
          original.call(this, value)
          setter.mockImplementationOnce(() => { throw error })
        } else {
          throw error
        }
      })
      action()
      await flush()
      expect(console.error).toHaveBeenCalledWith(error)
      vi.mocked(console.error).mockClear()
    }
    setter.mockRestore()
    api.setResults('')
    api.state.phoneRoute = null
    api.state.detailRoute = route
    api.state.view = 'list'
    await renderingFailure(() => api.commitTime())
  })

  it('reports a failed favorite-add action', async () => {
    await boot()
    const error = new Error('field unavailable')
    vi.spyOn(api.state.favInput, 'placeholder', 'set').mockImplementationOnce(() => { throw error })
    click('#fav-add')
    await flush()
    expect(console.error).toHaveBeenCalledWith(error)
  })
})

describe('SDK startup and lifecycle recovery', () => {
  it.each([new Error('startup unavailable'), StartUpPageCreateResult.outOfMemory])('retries failed page creation without blocking the phone planner: %s', async (failure) => {
    if (failure instanceof Error) mocks.bridge.createStartUpPageContainer.mockRejectedValueOnce(failure)
    else mocks.bridge.createStartUpPageContainer.mockResolvedValueOnce(failure)
    await boot()
    expect(mocks.bridge.createStartUpPageContainer).toHaveBeenCalledOnce()
    expect(mocks.bridge.textContainerUpgrade).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(2)
    if (failure instanceof Error) expect(console.error).toHaveBeenCalledWith(failure)
    else expect(console.error).toHaveBeenCalledWith('createStartUpPageContainer failed:', failure)
    input('#from', 'ut')
    input('#to', 'Amsterdam Centraal')
    click('#plan')
    await flush()
    expect(mocks.trips).toHaveBeenCalledOnce()
    expect(element('#results .trip-card')).toBeDefined()
    expect(mocks.bridge.createStartUpPageContainer).toHaveBeenCalledTimes(2)
    expect(lens()).toContain(route.toName)
  })

  it.each([new Error('initial display unavailable'), false])('keeps refresh active after a failed initial update: %s', async (failure) => {
    if (failure instanceof Error) mocks.bridge.textContainerUpgrade.mockRejectedValueOnce(failure)
    else mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(failure)
    await boot()
    expect(element('#plan')).toBeDefined()
    expect(vi.getTimerCount()).toBe(2)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: failure instanceof Error ? failure.message : 'textContainerUpgrade failed' }))
    await vi.advanceTimersByTimeAsync(10000)
    expect(mocks.bridge.createStartUpPageContainer).toHaveBeenCalledOnce()
    expect(mocks.bridge.textContainerUpgrade).toHaveBeenCalledTimes(2)
    expect(lens()).toContain('Please set a route')
  })

  it('serializes queued updates and continues after an earlier rejection', async () => {
    await boot()
    const pending = deferred<boolean>()
    mocks.bridge.textContainerUpgrade.mockReturnValueOnce(pending.promise)
    const first = api.draw('first')
    await flush()
    const second = api.draw('second')
    const third = api.draw('third')
    await flush()
    expect(mocks.bridge.textContainerUpgrade).toHaveBeenCalledTimes(2)
    const rejected = expect(first).rejects.toThrow('display disconnected')
    pending.reject(new Error('display disconnected'))
    await rejected
    await Promise.all([second, third])
    expect(mocks.bridge.textContainerUpgrade.mock.calls.slice(1).map(([container]) => container.content)).toEqual(['first', 'second', 'third'])
    mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(false)
    await expect(api.draw('failed')).rejects.toThrow('textContainerUpgrade failed')
    await api.draw('recovered')
    expect(lens()).toBe('recovered')
  })

  it('opens the list and detail with decoded text-container click events', async () => {
    await boot({ routes: [route] })
    const event = evenHubEventFromJson({ type: 'textEvent', jsonData: { Container_ID: 1, Container_Name: 'body', Event_Type: 0 } })
    eventHandler(event)
    await flush()
    expect(api.state.view).toBe('list')
    expect(mocks.trips).toHaveBeenCalledOnce()
    eventHandler(event)
    await flush()
    expect(api.state.view).toBe('detail')
    expect(lens()).toContain('ETA:')
  })

  it.each([false, new Error('exit unavailable')])('keeps navigation and refresh alive when the exit prompt does not exit: %s', async (result) => {
    await boot({ routes: [route] })
    if (result instanceof Error) mocks.bridge.shutDownPageContainer.mockRejectedValueOnce(result)
    else mocks.bridge.shutDownPageContainer.mockResolvedValueOnce(result)
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT, true)
    await flush()
    expect(mocks.bridge.shutDownPageContainer).toHaveBeenCalledWith(1)
    expect(mocks.unsubscribe).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(2)
    if (result instanceof Error) expect(console.error).toHaveBeenCalledWith(result)
    await vi.advanceTimersByTimeAsync(10000)
    gesture(OsEventTypeList.CLICK_EVENT)
    await flush()
    expect(api.state.view).toBe('list')
    expect(lens()).toContain(route.toName)
    gesture(OsEventTypeList.SYSTEM_EXIT_EVENT, true)
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['creation', 'update'])('does not start timers or send another update after exit during startup %s', async (operation) => {
    const pending = deferred<any>()
    const started = deferred<void>()
    const method = operation === 'creation' ? mocks.bridge.createStartUpPageContainer : mocks.bridge.textContainerUpgrade
    method.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const starting = boot()
    await started.promise
    expect(element('#plan')).toBeDefined()
    gesture(OsEventTypeList.SYSTEM_EXIT_EVENT, true)
    pending.resolve(operation === 'creation' ? StartUpPageCreateResult.success : true)
    await starting
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    const calls = mocks.bridge.textContainerUpgrade.mock.calls.length
    await api.renderLens()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.bridge.textContainerUpgrade).toHaveBeenCalledTimes(calls)
    if (operation === 'creation') expect(calls).toBe(0)
  })

  it('skips updates queued before cleanup and requested afterward', async () => {
    await boot()
    const pending = deferred<boolean>()
    mocks.bridge.textContainerUpgrade.mockReturnValueOnce(pending.promise)
    const first = api.draw('in flight')
    await flush()
    const queued = api.draw('queued')
    gesture(OsEventTypeList.ABNORMAL_EXIT_EVENT, true)
    const after = api.draw('after exit')
    pending.resolve(true)
    await Promise.all([first, queued, after])
    expect(mocks.bridge.textContainerUpgrade).toHaveBeenCalledTimes(2)
    expect(lens()).toBe('in flight')
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })

  it.each(['opening', 'refresh', 'planning'])('does not redraw a completed %s request after cleanup', async (action) => {
    await boot({ routes: [route] })
    if (action === 'refresh') await api.openTripList()
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    let request: Promise<void>
    if (action === 'planning') {
      input('#from', 'ut')
      input('#to', 'Amsterdam Centraal')
      request = api.planJourney()
    } else {
      request = action === 'opening' ? api.openTripList() : api.refreshOpenTrips()
    }
    await flush()
    gesture(OsEventTypeList.SYSTEM_EXIT_EVENT, true)
    const calls = mocks.bridge.textContainerUpgrade.mock.calls.length
    pending.resolve([trip()])
    await request
    await flush()
    expect(mocks.bridge.textContainerUpgrade).toHaveBeenCalledTimes(calls)
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('literal planner text', () => {
  it('preserves favorite station names and labels through saving, reloading, and reopening', async () => {
    const name = 'Utrecht\'s <b>West</b> &amp; "Hub"'
    const label = 'My "Office" &copy; &quot; <img src=x onerror="window.injected=true">'
    await boot()
    api.addFavorite({ code: 'UT', name })
    expect(element('#fav-list .row-name').textContent).toBe(name)
    click('#fav-list .favmenu')
    expect(element('#fav-edit .fav-preview-pill').textContent).toBe(name)
    expect(element<HTMLInputElement>('#fav-name').value).toBe(name)
    input('#fav-name', label)
    click('#fav-save')
    expect(element('#fav-list .row-name').textContent).toBe(label)
    expect(element('#fav-list').querySelector('img, b, [onerror]')).toBeNull()
    expect(element('#fav-list').querySelector('svg')).not.toBeNull()
    const storageCalls = mocks.bridge.setLocalStorage.mock.calls.filter(([key]) => key === 'perron-ns.favorites.v1')
    const stored = JSON.parse(storageCalls[storageCalls.length - 1][1])
    expect(stored).toEqual([{ code: 'UT', name, label, icon: 'default' }])
    api.cleanup()
    await boot({ favorites: stored })
    expect(element('#fav-list .row-name').textContent).toBe(label)
    click('#fav-list .favmenu')
    expect(element<HTMLInputElement>('#fav-name').value).toBe(label)
    expect(element('#fav-edit .fav-preview-pill').textContent).toBe(name)
    expect(element('#fav-edit').querySelector('img, b, [onerror]')).toBeNull()
    click('#fav-save')
    expect(api.state.favorites[0]).toEqual(stored[0])
    expect(mocks.bridge.setLocalStorage).toHaveBeenLastCalledWith('perron-ns.favorites.v1', JSON.stringify(stored))
  })

  it('renders stored route names literally while preserving the route icon', async () => {
    const fromName = 'Utrecht <b>West</b> &copy; "Hub"'
    const toName = 'Amsterdam <img src=x onerror="window.injected=true"> &amp; East'
    await boot({ routes: [{ ...route, fromName, toName }] })
    const row = element('#saved .row-name')
    expect(row.firstChild!.textContent).toBe(fromName + ' ')
    expect(row.lastChild!.textContent).toBe(' ' + toName)
    expect(row.querySelector('img, b, [onerror]')).toBeNull()
    expect(row.querySelector('svg')).not.toBeNull()
  })

  it('renders external cancellation, service, station, platform, and journey-stop text literally', async () => {
    const reason = 'Cancelled <img src=x onerror="window.injected=true"> &copy; "Today"'
    const origin = 'Utrecht <b>West</b> &quot; Hub'
    const destination = 'Amsterdam <img src=x onerror="window.injected=true"> &amp; East'
    const category = 'IC <b>Line</b> &copy;'
    const displayName = 'Intercity <img src=x onerror="window.injected=true"> &amp; Express'
    const direction = 'Amsterdam <b>East</b> &quot;'
    const originTrack = '5 <b>West</b> &copy;'
    const destinationTrack = '7 <img src=x onerror="window.injected=true">'
    const middle = stop('Amstel <img src=x onerror="window.injected=true"> &copy;', { track: '2 <b>South</b> &amp;' })
    const partial = [stop(origin, { track: originTrack }), middle, stop(destination, { track: destinationTrack })]
    const full = [stop('Before <b>West</b> &copy;'), ...partial, stop('After <img src=x onerror="window.injected=true">')]
    const itinerary = trip({ cancelled: true, cancellationReason: reason, legs: [leg({ origin, destination, category, displayName, direction, originTrack, destinationTrack, stops: partial })] })
    mocks.trips.mockResolvedValue([itinerary])
    mocks.journey.mockResolvedValue(full)
    await boot()
    input('#from', route.fromName, route.fromCode)
    input('#to', route.toName, route.toCode)
    click('#plan')
    await flush()
    expect(element('#results .trip-cancelled').textContent).toContain(reason)
    expect(element('#results .badge').lastChild!.textContent).toBe(category)
    expect(element('#results').querySelector('img, b, [onerror]')).toBeNull()
    expect(element('#results').querySelector('svg')).not.toBeNull()
    click('#results .trip-card')
    expect(element('#detail .detail-title-main').textContent).toBe(origin + ' - ' + destination)
    expect(element('#detail .trip-cancelled').textContent).toContain(reason)
    expect(element('#detail .badge').lastChild!.textContent).toBe(category)
    expect(Array.from(element('#detail').querySelectorAll('.leg-station'), el => el.textContent)).toEqual([origin, destination])
    expect(element('#detail .leg-service-name').textContent).toBe(displayName + ' 123')
    expect(element('#detail .leg-service-dir').textContent).toContain(direction)
    expect(Array.from(element('#detail').querySelectorAll('.platform'), el => el.textContent)).toEqual([originTrack, destinationTrack])
    expect(element('#detail').querySelector('img, b, [onerror]')).toBeNull()
    click('#detail .leg-service--tap')
    expect(Array.from(element('#stops').querySelectorAll('.stop-name'), el => el.textContent)).toEqual(partial.map(s => s.name))
    await flush()
    expect(element('#stops .detail-title-main').textContent).toBe(displayName + ' 123')
    expect(element('#stops .detail-title-sub').textContent).toContain(direction)
    expect(Array.from(element('#stops').querySelectorAll('.stop-name'), el => el.textContent)).toEqual(full.map(s => s.name))
    expect(Array.from(element('#stops').querySelectorAll('.platform'), el => el.textContent)).toEqual(full.map(s => s.track))
    expect(element('#stops').querySelector('img, b, [onerror]')).toBeNull()
    expect(element('#stops').querySelector('svg')).not.toBeNull()
  })

  it('renders transfer platforms and operators literally while preserving transfer icons', async () => {
    await boot()
    const originTrack = '9 <b>West</b> &copy;'
    const previousOperator = 'NS<b>Rail</b>'
    const nextOperator = 'Arriva&amp;Transit'
    const first = leg({ operator: previousOperator, arrival: '2026-10-02T10:00:00Z' })
    const next = leg({ operator: nextOperator, departure: '2026-10-02T10:10:00Z', originTrack })
    api.showDetail(trip({ legs: [first, next] }))
    const transfer = element('#detail .xfer')
    const text = Array.from(transfer.querySelectorAll('.xfer-text'), el => el.textContent)
    expect(text).toContain('Walk to platform ' + originTrack)
    expect(text).toContain('Check out/in: ' + previousOperator + ' - ' + nextOperator)
    expect(transfer.querySelector('img, b, [onerror]')).toBeNull()
    expect(transfer.querySelector('svg')).not.toBeNull()
  })
})

describe('planning request ordering', () => {
  it.each(['resolve', 'reject'])('keeps the newer phone plan when the older request later %ss', async (outcome) => {
    await boot({ routes: [route, amstelRoute] })
    const older = deferred<Trip[]>()
    const newer = deferred<Trip[]>()
    const current = trip({ legs: [leg({ category: 'SPR', trainNumber: '456', destination: amstelRoute.toName })] })
    mocks.trips.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    click('#saved .chip:nth-child(1)')
    click('#saved .chip:nth-child(2)')
    newer.resolve([current])
    await flush()
    const writes = mocks.bridge.setLocalStorage.mock.calls.length
    if (outcome === 'resolve') older.resolve([trip({ cancelled: true, cancellationReason: 'Obsolete journey' })])
    else older.reject(new Error('Obsolete failure'))
    await flush()
    expect(api.state.phoneRoute).toEqual(amstelRoute)
    expect(api.state.detailRoute).toEqual(amstelRoute)
    expect(api.state.detailTrips).toEqual([current])
    expect(api.state.detailStatus).toBe('ready')
    expect(api.state.savedRoutes).toEqual([amstelRoute, route])
    expect(mocks.bridge.setLocalStorage.mock.calls).toHaveLength(writes)
    expect(element('#results').textContent).toContain('SPR')
    expect(element('#results').textContent).not.toContain('Obsolete')
    expect(element('#error-modal').hidden).toBe(true)
    expect(lens()).toContain('Utrecht Centraal > Amsterdam Amstel')
    click('#results .trip-card')
    await flush()
    expect(element('#detail').textContent).toContain(amstelRoute.toName)
    expect(lens()).toContain(amstelRoute.toName + ' | ETA:')
  })

  it.each(['edit', 'clear', 'swap', 'favorite'].flatMap((action) => ['resolve', 'reject'].map((outcome) => [action, outcome])))('invalidates a pending phone plan on %s before it can %s', async (action, outcome) => {
    await boot({ routes: [route], favorites: [{ code: 'ASA', name: amstelRoute.toName }] })
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    click('#saved .chip')
    await flush()
    expect(element('#results').textContent).toContain('Planning')
    if (action === 'edit') input('#to', 'Amsterdam Amstel', 'ASA')
    else if (action === 'clear') click('#clear-search')
    else if (action === 'swap') click('#swap')
    else click('#fav-list .fav')
    await flush()
    const writes = mocks.bridge.setLocalStorage.mock.calls.length
    if (outcome === 'resolve') pending.resolve([trip({ cancelled: true, cancellationReason: 'Obsolete journey' })])
    else pending.reject(new Error('Obsolete failure'))
    await flush()
    expect(api.state.phoneRoute).toBeNull()
    expect(api.state.detailRoute).toBeNull()
    expect(api.state.detailTrips).toEqual([])
    expect(api.state.savedRoutes).toEqual([route])
    expect(api.state.view).toBe('home')
    expect(element('#results').innerHTML).toBe('')
    expect(element('#home-sections').hidden).toBe(false)
    expect(element('#detail').hidden).toBe(true)
    expect(element('#stops').hidden).toBe(true)
    expect(element('#error-modal').hidden).toBe(true)
    expect(mocks.bridge.setLocalStorage.mock.calls).toHaveLength(writes)
    expect(lens()).toContain('Please set a route')
    expect(lens()).not.toContain('Obsolete')
  })

  it.each(['another route', 'the same route'])('opens the sixth phone result from its own snapshot after the lens loads %s', async (target) => {
    await boot({ routes: [route, amstelRoute] })
    const options = Array.from({ length: 6 }, (_, i) => {
      const departure = '2026-10-02T10:' + (20 + i) + ':00Z'
      return trip({ departure, cancelled: i === 5, cancellationReason: i === 5 ? 'Sixth service' : '', legs: [leg({ departure, trainNumber: String(120 + i), originTrack: String(11 + i) })] })
    })
    mocks.trips.mockResolvedValueOnce(options)
    click('#saved .chip:nth-child(1)')
    await flush()
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    if (target === 'another route') gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    mocks.trips.mockResolvedValueOnce([trip({ legs: [leg({ originTrack: '99', trainNumber: '999' })] })])
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(lens()).toContain(target === 'another route' ? amstelRoute.toName : route.toName)
    click('#results .trip-card:nth-child(6)')
    await flush()
    expect(api.state.detailRoute).toEqual(route)
    expect(api.state.detailTrips).toBe(options)
    expect(api.state.tripIdx).toBe(5)
    expect(api.state.view).toBe('detail')
    expect(element('#results').querySelectorAll('.trip-card')).toHaveLength(6)
    expect(element('#detail').textContent).toContain('Sixth service')
    expect(lens()).toContain('Sixth service')
    expect(lens()).toContain('Platform: 16')
    expect(lens()).not.toContain('Platform: 99')
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    await flush()
    expect(api.visibleTripCount()).toBe(5)
    expect(api.state.tripIdx).toBe(4)
    expect(lens()).not.toContain(api.hhmm(options[5].departure))
  })

  it.each(['resolve', 'reject'])('keeps a reopened lens route ready when an earlier request later %ss', async (outcome) => {
    await boot({ routes: [route] })
    const phone = trip({ legs: [leg({ category: 'SPR' })] })
    mocks.trips.mockResolvedValueOnce([phone])
    click('#saved .chip')
    await flush()
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    const older = deferred<Trip[]>()
    const newer = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    await api.refreshOpenTrips()
    expect(mocks.trips).toHaveBeenCalledTimes(3)
    const current = trip({ departure: '2026-10-02T10:40:00Z', legs: [leg({ departure: '2026-10-02T10:40:00Z' })] })
    newer.resolve([current])
    await flush()
    const content = lens()
    if (outcome === 'resolve') older.resolve([trip({ cancelled: true })])
    else older.reject(new Error('Obsolete lens failure'))
    await flush()
    expect(api.state.detailTrips).toEqual([current])
    expect(api.state.detailStatus).toBe('ready')
    expect(lens()).toBe(content)
    expect(element('#results').textContent).toContain('SPR')
    expect(element('#results').textContent).not.toContain('Cancelled')
    expect(element('#error-modal').hidden).toBe(true)
  })

  it('does not start a lens fetch if a newer route opens while its loading draw is pending', async () => {
    await boot({ routes: [route, amstelRoute] })
    const display = deferred<boolean>()
    mocks.bridge.textContainerUpgrade.mockReturnValueOnce(display.promise)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    display.resolve(true)
    await flush()
    expect(mocks.trips).toHaveBeenCalledOnce()
    expect(mocks.trips).toHaveBeenCalledWith('UT', 'ASA', { lang: 'en' })
    expect(api.state.detailRoute).toEqual(amstelRoute)
    expect(api.state.detailStatus).toBe('ready')
    expect(lens()).toContain('Utrecht Centraal > Amsterdam Amstel')
    expect(element('#results').innerHTML).toBe('')
  })

  it.each(['resolve', 'reject'])('preserves the exact same-departure itinerary across overlapping refreshes when the older request %ss', async (outcome) => {
    await boot({ routes: [route] })
    const first = trip()
    const selected = trip({ legs: [leg({ trainNumber: '456', service: 'IC 456' })] })
    mocks.trips.mockResolvedValueOnce([first, selected])
    click('#saved .chip')
    await flush()
    click('#results .trip-card:nth-child(2)')
    await flush()
    const older = deferred<Trip[]>()
    const newer = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const refresh1 = api.refreshOpenTrips()
    const refresh2 = api.refreshOpenTrips()
    const updated = trip({ cancelled: true, cancellationReason: 'Current disruption', legs: [leg({ trainNumber: '456', service: 'IC 456', originTrack: '12', departureDelayMin: 8 })] })
    const current = [trip({ departure: '2026-10-02T10:10:00Z' }), first, updated]
    newer.resolve(current)
    await refresh2
    expect(api.state.tripIdx).toBe(2)
    expect(api.state.phoneDetailTrip).toBe(updated)
    expect(element('#results .selected').dataset.idx).toBe('2')
    expect(element('#detail').textContent).toContain('Current disruption')
    expect(lens()).toContain('Current disruption')
    expect(lens()).toContain('Platform: 12')
    const content = lens()
    if (outcome === 'resolve') older.resolve([trip({ cancelled: true, cancellationReason: 'Obsolete disruption' })])
    else older.reject(new Error('Obsolete refresh failure'))
    await refresh1
    expect(api.state.detailTrips).toBe(current)
    expect(api.state.tripIdx).toBe(2)
    expect(element('#detail').textContent).not.toContain('Obsolete')
    expect(element('#results').querySelectorAll('.trip-card')).toHaveLength(3)
    expect(lens()).toBe(content)
  })

  it('ignores an older refresh while the same route is reopening', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    const refresh = deferred<Trip[]>()
    const reopen = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(refresh.promise).mockReturnValueOnce(reopen.promise)
    const refreshing = api.refreshOpenTrips()
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    refresh.resolve([trip({ cancelled: true, cancellationReason: 'Obsolete disruption' })])
    await refreshing
    expect(api.state.detailStatus).toBe('loading')
    expect(api.state.detailTrips).toEqual([])
    expect(lens()).toContain('Loading times...')
    expect(element('#results').textContent).not.toContain('Obsolete')
    reopen.resolve([trip({ transfers: 2 })])
    await flush()
    expect(api.state.detailStatus).toBe('ready')
    expect(lens()).toContain('2x Transfers')
  })

  it('closes phone detail and stops when its itinerary disappears during refresh', async () => {
    await boot({ routes: [route] })
    const remaining = trip()
    mocks.trips.mockResolvedValueOnce([remaining, trip({ legs: [leg({ trainNumber: '456' })] })])
    click('#saved .chip')
    await flush()
    click('#results .trip-card:nth-child(2)')
    const stops = deferred<LegStop[]>()
    mocks.journey.mockReturnValueOnce(stops.promise)
    click('.leg-service--tap')
    mocks.trips.mockResolvedValueOnce([remaining])
    await api.refreshOpenTrips()
    stops.resolve([stop('Obsolete stop'), stop(route.fromName), stop(route.toName)])
    await flush()
    expect(api.state.phoneDetailTrip).toBeNull()
    expect(element('#detail').hidden).toBe(true)
    expect(element('#stops').hidden).toBe(true)
    expect(element('#results').querySelectorAll('.trip-card')).toHaveLength(1)
    expect(api.state.detailTrips).toEqual([remaining])
    expect(api.state.tripIdx).toBe(0)
    expect(lens()).toContain('ETA:')
    expect(lens()).not.toContain('Obsolete')
  })

  it('retries the active phone route after a failure when the requested time changes', async () => {
    await boot({ routes: [route] })
    input('#from', route.fromName, route.fromCode)
    input('#to', amstelRoute.toName, amstelRoute.toCode)
    mocks.trips.mockRejectedValueOnce(new Error('offline'))
    click('#plan')
    await flush()
    click('.modal-ok')
    click('#dep-box')
    click('#tab-arr')
    click('#date-next')
    api.state.hourWheel.set(8)
    api.state.minWheel.set(5)
    const retried = trip({ legs: [leg({ destination: amstelRoute.toName })] })
    mocks.trips.mockResolvedValueOnce([retried])
    click('#time-done')
    await flush()
    expect(mocks.trips.mock.calls[1]).toEqual(['UT', 'ASA', { lang: 'en', dateTime: api.state.planDateTime.toISOString(), searchForArrival: true }])
    expect(api.state.phoneRoute).toEqual(amstelRoute)
    expect(api.state.detailRoute).toEqual(amstelRoute)
    expect(api.state.detailTrips).toEqual([retried])
    expect(api.state.savedRoutes[0]).toEqual(amstelRoute)
    expect(element('#results').querySelectorAll('.trip-card')).toHaveLength(1)
    expect(element('#error-modal').hidden).toBe(true)
    expect(lens()).toContain('Utrecht Centraal > Amsterdam Amstel')
  })

  it('replans an active lens route even after it is removed from phone history', async () => {
    await boot({ routes: [route, amstelRoute] })
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    click('#saved .chip:nth-child(2) .del')
    click('#dep-box')
    click('#time-done')
    await flush()
    expect(mocks.trips.mock.calls.map((call) => call.slice(0, 2))).toEqual([['UT', 'ASA'], ['UT', 'ASA']])
    expect(api.state.detailRoute).toEqual(amstelRoute)
    expect(api.state.savedRoutes).toEqual([route])
    expect(element('#results').innerHTML).toBe('')
    expect(lens()).toContain('Utrecht Centraal > Amsterdam Amstel')
  })

  it.each(['resolve', 'reject'])('invalidates an old-language phone response that later %ss', async (outcome) => {
    await boot({ routes: [route] })
    const english = deferred<Trip[]>()
    const dutch = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(english.promise).mockReturnValueOnce(dutch.promise)
    click('#saved .chip')
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    expect(mocks.trips.mock.calls).toEqual([['UT', 'ASD', { lang: 'en' }], ['UT', 'ASD', { lang: 'nl' }]])
    const current = trip({ cancelled: true, cancellationReason: 'Nederlandse melding' })
    dutch.resolve([current])
    await flush()
    click('#results .trip-card')
    await flush()
    if (outcome === 'resolve') english.resolve([trip({ cancelled: true, cancellationReason: 'English message' })])
    else english.reject(new Error('English failure'))
    await flush()
    expect(api.state.detailTrips).toEqual([current])
    expect(api.state.phoneDetailTrip).toBe(current)
    expect(element('#results').textContent).toContain('Nederlandse melding')
    expect(element('#detail').textContent).toContain('Nederlandse melding')
    expect(element('#error-modal').hidden).toBe(true)
    expect(lens()).toContain('Nederlandse melding')
    expect(lens()).not.toContain('English')
  })

  it('preserves a selected itinerary while language replanning replaces its API text', async () => {
    await boot({ routes: [route] })
    const selected = trip({ cancelled: true, cancellationReason: 'English message', legs: [leg({ trainNumber: '456' })] })
    mocks.trips.mockResolvedValueOnce([trip(), selected])
    click('#saved .chip')
    await flush()
    click('#results .trip-card:nth-child(2)')
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    expect(element('#detail').hidden).toBe(true)
    expect(element('#results').textContent).toContain('Planning')
    expect(lens()).toContain('Loading times...')
    const updated = { ...selected, cancellationReason: 'Nederlandse melding' }
    pending.resolve([trip(), trip({ departure: '2026-10-02T10:10:00Z' }), updated])
    await flush()
    expect(api.state.tripIdx).toBe(2)
    expect(api.state.phoneDetailTrip).toBe(updated)
    expect(element('#detail').hidden).toBe(false)
    expect(element('#detail').textContent).toContain('Nederlandse melding')
    expect(element('#results .selected').dataset.idx).toBe('2')
    expect(lens()).toContain('Nederlandse melding')
    expect(lens()).not.toContain('English message')
  })

  it('replans independent phone and lens routes in the new language', async () => {
    await boot({ routes: [route, amstelRoute] })
    const phone = trip({ cancelled: true, cancellationReason: 'English phone message' })
    mocks.trips.mockResolvedValueOnce([phone])
    click('#saved .chip:nth-child(1)')
    await flush()
    click('#results .trip-card')
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    const glasses = trip({ cancelled: true, cancellationReason: 'English lens message', legs: [leg({ trainNumber: '456', destination: amstelRoute.toName })] })
    mocks.trips.mockResolvedValueOnce([glasses])
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    gesture(OsEventTypeList.CLICK_EVENT, true)
    const phoneNl = deferred<Trip[]>()
    const lensNl = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(phoneNl.promise).mockReturnValueOnce(lensNl.promise)
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    expect(mocks.trips.mock.calls.slice(2)).toEqual([['UT', 'ASD', { lang: 'nl' }], ['UT', 'ASA', { lang: 'nl' }]])
    expect(element('#detail').hidden).toBe(true)
    expect(lens()).toContain('Loading times...')
    const updatedLens = { ...glasses, cancellationReason: 'Nederlandse lensmelding' }
    lensNl.resolve([updatedLens])
    await flush()
    const updatedPhone = { ...phone, cancellationReason: 'Nederlandse telefoonmelding' }
    phoneNl.resolve([updatedPhone])
    await flush()
    expect(api.state.detailRoute).toEqual(amstelRoute)
    expect(api.state.detailTrips).toEqual([updatedLens])
    expect(element('#results').textContent).toContain('Nederlandse telefoonmelding')
    expect(element('#detail').textContent).toContain('Nederlandse telefoonmelding')
    expect(lens()).toContain('Nederlandse lensmelding')
    expect(lens()).not.toContain('English')
    click('#results .trip-card')
    await flush()
    expect(api.state.detailRoute).toEqual(route)
    expect(lens()).toContain('Nederlandse telefoonmelding')
  })

  it('invalidates an old-language lens request when language changes during loading', async () => {
    await boot({ routes: [route] })
    const english = deferred<Trip[]>()
    const dutch = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(english.promise).mockReturnValueOnce(dutch.promise)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    const current = trip({ legs: [leg({ originTrack: '12' })] })
    dutch.resolve([current])
    await flush()
    english.reject(new Error('English failure'))
    await flush()
    expect(mocks.trips.mock.calls).toEqual([['UT', 'ASD', { lang: 'en' }], ['UT', 'ASD', { lang: 'nl' }]])
    expect(api.state.detailStatus).toBe('ready')
    expect(api.state.detailTrips).toEqual([current])
    expect(element('#results').innerHTML).toBe('')
    expect(element('#error-modal').hidden).toBe(true)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(lens()).toContain('Platform: 12')
    expect(lens()).not.toContain('English failure')
  })

  it('keeps the active plan when choosing a station to save as a favorite', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    click('#results .trip-card')
    await flush()
    input('#fav-input', 'ut')
    key('#fav-input', 'Enter')
    expect(element<HTMLInputElement>('#fav-input').dataset.code).toBe('UT')
    expect(api.state.phoneRoute).toEqual(route)
    expect(element('#detail').hidden).toBe(false)
    expect(element('#results').querySelectorAll('.trip-card')).toHaveLength(1)
    expect(lens()).toContain('ETA:')
  })

  it('shows a language replan failure on the lens while closing the old phone detail', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    click('#results .trip-card')
    await flush()
    mocks.trips.mockRejectedValueOnce(new Error('Nieuwe foutmelding'))
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    expect(api.state.detailStatus).toBe('error')
    expect(api.state.detailRoute).toEqual(route)
    expect(element('#detail').hidden).toBe(true)
    expect(element('#results').innerHTML).toBe('')
    expect(element('.modal-text').textContent).toContain('Nieuwe foutmelding')
    expect(lens()).toContain('Utrecht Centraal > Amsterdam Centraal')
    expect(lens()).toContain('Nieuwe foutmelding')
  })

  it('reports a phone view failure while starting a language replan', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    const error = new Error('phone view unavailable')
    vi.spyOn(api.state.results, 'innerHTML', 'set').mockImplementationOnce(() => { throw error })
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    expect(console.error).toHaveBeenCalledWith(error)
    expect(mocks.trips).toHaveBeenCalledOnce()
    expect(api.state.detailRoute).toEqual(route)
    expect(element('#results').querySelectorAll('.trip-card')).toHaveLength(1)
  })

  it.each([1, 2, 3])('reports a lens display failure on update %i while starting a language replan', async (update) => {
    await boot({ routes: [route] })
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    const error = new Error('lens display unavailable')
    if (update >= 2) mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(true)
    if (update === 3) mocks.bridge.textContainerUpgrade.mockResolvedValueOnce(true)
    mocks.bridge.textContainerUpgrade.mockRejectedValueOnce(error)
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    expect(console.error).toHaveBeenCalledWith(error)
    expect(mocks.trips).toHaveBeenCalledTimes(2)
    expect(api.state.detailRoute).toEqual(route)
    expect(element('#results').innerHTML).toBe('')
    expect(mocks.trips).toHaveBeenLastCalledWith('UT', 'ASD', { lang: 'nl' })
    expect(api.state.detailStatus).toBe('ready')
  })
})

describe('journey lifecycle and independent views', () => {
  it('restores the selected replacement card after a valid refresh reorders results', async () => {
    await boot({ routes: [route] })
    const first = trip()
    const selected = trip({ legs: [leg({ trainNumber: '456' })] })
    mocks.trips.mockResolvedValueOnce([first, selected])
    click('#saved .row-select')
    await flush()
    const original = element('#results .trip-card:nth-child(2)')
    original.focus()
    key('#results .trip-card:nth-child(2)', 'Enter')
    element('.leg-service--tap').focus()
    const oldLeg = document.activeElement
    element('#detail').scrollTop = 180
    const updated = { ...selected, legs: [{ ...selected.legs[0], originTrack: '19' }] }
    mocks.trips.mockResolvedValueOnce([updated, first])
    await api.refreshOpenTrips()
    const current = element('#results .trip-card.selected')
    expect(current.dataset.idx).toBe('0')
    expect(original.isConnected).toBe(false)
    expect(document.activeElement).toBe(element('.leg-service--tap'))
    expect(document.activeElement).not.toBe(oldLeg)
    expect(element('#detail').scrollTop).toBe(180)
    expect(element('#app').hasAttribute('inert')).toBe(true)
    key('.leg-service--tap', 'Escape')
    await flush()
    expect(document.activeElement).toBe(current)
    expect(element('#app').hasAttribute('inert')).toBe(false)
    expect(api.state.phoneOverlayFocus.size).toBe(0)
    expect(api.state.view).toBe('list')
  })

  it('releases nested focus layers when refresh removes their itinerary and ignores a late stop response', async () => {
    await boot({ routes: [route] })
    click('#saved .row-select')
    await flush()
    element('#results .trip-card').focus()
    key('#results .trip-card', 'Enter')
    const stops = deferred<LegStop[]>()
    mocks.journey.mockReturnValueOnce(stops.promise)
    element('.leg-service--tap').focus()
    key('.leg-service--tap', 'Enter')
    expect(document.activeElement).toBe(element('#stops-back'))
    mocks.trips.mockResolvedValueOnce([trip({ legs: [leg({ trainNumber: '789' })] })])
    await api.refreshOpenTrips()
    expect(element('#detail').hidden).toBe(true)
    expect(element('#stops').hidden).toBe(true)
    expect(element('#app').hasAttribute('inert')).toBe(false)
    expect(element('#detail').hasAttribute('inert')).toBe(false)
    expect(api.state.phoneOverlayFocus.size).toBe(0)
    expect(api.state.phoneDetailTrip).toBeNull()
    expect(document.activeElement).toBe(element('#from'))
    const card = element('#results .trip-card')
    card.focus()
    const content = lens()
    api.closeDetail()
    expect(lens()).toBe(content)
    expect(document.activeElement).toBe(card)
    stops.resolve([stop(route.fromName), stop(route.toName)])
    await flush()
    expect(element('#stops').hidden).toBe(true)
    expect(document.activeElement).toBe(card)
    expect(element('#app').hasAttribute('inert')).toBe(false)
  })

  it.each(['clear', 'edit', 'replan'])('releases nested keyboard focus when %s resets the phone view', async (action) => {
    await boot({ routes: [route] })
    click('#saved .row-select')
    await flush()
    element('#results .trip-card').focus()
    key('#results .trip-card', 'Enter')
    element('.leg-service--tap').focus()
    key('.leg-service--tap', 'Enter')
    await flush()
    expect(element('#app').hasAttribute('inert')).toBe(true)
    const pending = deferred<Trip[]>()
    let planning: Promise<void> | undefined
    if (action === 'clear') click('#clear-search')
    else if (action === 'edit') input('#to', 'Edited station')
    else {
      mocks.trips.mockReturnValueOnce(pending.promise)
      planning = api.planJourney(route)
    }
    expect(element('#detail').hidden).toBe(true)
    expect(element('#stops').hidden).toBe(true)
    expect(element('#app').hasAttribute('inert')).toBe(false)
    expect(element('#detail').hasAttribute('inert')).toBe(false)
    expect(api.state.phoneOverlayFocus.size).toBe(0)
    expect(api.state.activePhoneDetailClose).toBeNull()
    element('#from').focus()
    expect(document.activeElement).toBe(element('#from'))
    if (action === 'replan') {
      pending.resolve([trip({ legs: [leg({ originTrack: '19' })] })])
      await planning
      expect(element('#detail').hidden).toBe(false)
      expect(document.activeElement).toBe(element('#detail-back'))
      expect(element('#app').hasAttribute('inert')).toBe(true)
      key('#detail-back', 'Escape')
      expect(api.state.phoneOverlayFocus.size).toBe(0)
      expect(element('#app').hasAttribute('inert')).toBe(false)
    } else {
      expect(element('#results').innerHTML).toBe('')
      expect(api.state.phoneRoute).toBeNull()
    }
  })

  it.each(['phone', 'lens', 'refresh'].flatMap((source) => ['resolve', 'reject'].map((outcome) => [source, outcome])))('ignores a pending %s response that %ss after exit', async (source, outcome) => {
    await boot({ routes: [route] })
    if (source === 'refresh') {
      click('#saved .chip')
      await flush()
    }
    const pending = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(pending.promise)
    if (source === 'phone') click('#saved .chip')
    else if (source === 'lens') gesture(OsEventTypeList.CLICK_EVENT, true)
    else api.refreshOpenTrips()
    await flush()
    gesture(OsEventTypeList.SYSTEM_EXIT_EVENT, true)
    const trips = api.state.detailTrips
    const status = api.state.detailStatus
    const results = element('#results').innerHTML
    const content = lens()
    const history = api.state.savedRoutes
    const writes = mocks.bridge.setLocalStorage.mock.calls.length
    if (outcome === 'resolve') pending.resolve([trip({ cancelled: true, cancellationReason: 'Late journey after exit' })])
    else pending.reject(new Error('Late failure after exit'))
    await flush()
    expect(api.state.cleanedUp).toBe(true)
    expect(api.state.detailTrips).toBe(trips)
    expect(api.state.detailStatus).toBe(status)
    expect(api.state.savedRoutes).toBe(history)
    expect(mocks.bridge.setLocalStorage.mock.calls).toHaveLength(writes)
    expect(element('#results').innerHTML).toBe(results)
    expect(element('#error-modal').hidden).toBe(true)
    expect(lens()).toBe(content)
    expect(lens()).not.toContain('Late')
  })

  it.each(['phone', 'lens'].flatMap((source) => ['resolve', 'reject'].map((outcome) => [source, outcome])))('retains the selected %s itinerary through rapid language changes when the superseded request %ss', async (source, outcome) => {
    await boot({ routes: [route] })
    const first = trip()
    const selected = trip({ legs: [leg({ trainNumber: '456', service: 'IC 456' })] })
    mocks.trips.mockResolvedValueOnce([first, selected])
    if (source === 'phone') {
      click('#saved .chip')
      await flush()
      click('#results .trip-card:nth-child(2)')
    } else {
      gesture(OsEventTypeList.CLICK_EVENT, true)
      await flush()
      gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
      gesture(OsEventTypeList.CLICK_EVENT, true)
    }
    await flush()
    expect(api.state.tripIdx).toBe(1)
    const dutch = deferred<Trip[]>()
    const english = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(dutch.promise).mockReturnValueOnce(english.promise)
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(2)')
    await flush()
    click('#lang-toggle')
    click('#lang-menu .option:nth-child(1)')
    await flush()
    expect(mocks.trips.mock.calls.slice(1)).toEqual([['UT', 'ASD', { lang: 'nl' }], ['UT', 'ASD', { lang: 'en' }]])
    const current = { ...selected, cancelled: true, cancellationReason: 'Current itinerary' }
    english.resolve([current, first])
    await flush()
    expect(api.state.tripIdx).toBe(0)
    expect(api.state.detailTrips[api.state.tripIdx]).toBe(current)
    expect(lens()).toContain('Current itinerary')
    if (source === 'phone') {
      expect(api.state.phoneDetailTrip).toBe(current)
      expect(element('#results .selected').dataset.idx).toBe('0')
      expect(element('#detail').textContent).toContain('Current itinerary')
    } else {
      expect(element('#results').innerHTML).toBe('')
    }
    const content = lens()
    const results = element('#results').innerHTML
    if (outcome === 'resolve') dutch.resolve([first, { ...selected, cancelled: true, cancellationReason: 'Verouderde melding' }])
    else dutch.reject(new Error('Verouderde foutmelding'))
    await flush()
    expect(api.state.tripIdx).toBe(0)
    expect(api.state.detailTrips[api.state.tripIdx]).toBe(current)
    expect(element('#results').innerHTML).toBe(results)
    expect(element('#error-modal').hidden).toBe(true)
    expect(lens()).toBe(content)
  })

  it('replans independently active phone and lens routes when time changes', async () => {
    await boot({ routes: [route, amstelRoute] })
    const phone = trip({ cancelled: true, cancellationReason: 'Phone itinerary' })
    mocks.trips.mockResolvedValueOnce([phone])
    click('#saved .chip:nth-child(1)')
    await flush()
    click('#results .trip-card')
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    const glasses = trip({ cancelled: true, cancellationReason: 'Lens itinerary', legs: [leg({ trainNumber: '456', destination: amstelRoute.toName })] })
    mocks.trips.mockResolvedValueOnce([trip({ legs: [leg({ destination: amstelRoute.toName })] }), glasses])
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    const phoneTime = deferred<Trip[]>()
    const lensTime = deferred<Trip[]>()
    mocks.trips.mockReturnValueOnce(phoneTime.promise).mockReturnValueOnce(lensTime.promise)
    click('#dep-box')
    click('#tab-arr')
    click('#date-next')
    api.state.hourWheel.set(8)
    api.state.minWheel.set(5)
    click('#time-done')
    await flush()
    const options = { lang: 'en', dateTime: api.state.planDateTime.toISOString(), searchForArrival: true }
    expect(mocks.trips.mock.calls.slice(2)).toEqual([['UT', 'ASD', options], ['UT', 'ASA', options]])
    expect(api.state.phoneRoute).toEqual(route)
    expect(api.state.detailRoute).toEqual(amstelRoute)
    const updatedLens = { ...glasses, cancellationReason: 'Lens itinerary at new time' }
    lensTime.resolve([updatedLens])
    await flush()
    const updatedPhone = { ...phone, cancellationReason: 'Phone itinerary at new time' }
    phoneTime.resolve([updatedPhone])
    await flush()
    expect(api.state.detailRoute).toEqual(amstelRoute)
    expect(api.state.detailTrips).toEqual([updatedLens])
    expect(api.state.tripIdx).toBe(0)
    expect(api.state.view).toBe('detail')
    expect(element('#results').textContent).toContain('Phone itinerary at new time')
    expect(element('#detail').textContent).toContain('Phone itinerary at new time')
    expect(lens()).toContain('Lens itinerary at new time')
    expect(lens()).toContain(amstelRoute.toName)
  })

  it.each(['another route', 'another itinerary', 'the same itinerary'].flatMap((context) => ['Back', 'Escape'].map((action) => [context, action])))('closes phone detail in its own context while the lens shows %s using %s', async (context, action) => {
    await boot({ routes: [route, amstelRoute] })
    const phone = trip({ cancelled: true, cancellationReason: 'Phone itinerary' })
    mocks.trips.mockResolvedValueOnce([phone])
    click('#saved .chip:nth-child(1)')
    await flush()
    click('#results .trip-card')
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    gesture(OsEventTypeList.DOUBLE_CLICK_EVENT)
    if (context === 'another route') gesture(OsEventTypeList.SCROLL_BOTTOM_EVENT)
    const current = context === 'the same itinerary' ? { ...phone, legs: [leg({ originTrack: '12' })] } : trip({ cancelled: true, cancellationReason: 'Lens itinerary', legs: [leg({ trainNumber: '456', destination: context === 'another route' ? amstelRoute.toName : route.toName })] })
    mocks.trips.mockResolvedValueOnce([current])
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    const content = lens()
    const lensRoute = api.state.detailRoute
    if (action === 'Back') click('#detail-back')
    else key('#detail-back', 'Escape')
    await flush()
    expect(element('#detail').hidden).toBe(true)
    expect(api.state.phoneDetailTrip).toBeNull()
    expect(api.state.detailRoute).toBe(lensRoute)
    expect(api.state.detailTrips).toEqual([current])
    if (context === 'the same itinerary') {
      expect(api.state.view).toBe('list')
      expect(lens()).not.toContain('ETA:')
    } else {
      expect(api.state.view).toBe('detail')
      expect(lens()).toBe(content)
      expect(lens()).toContain('Lens itinerary')
    }
  })

  it('fetches the route and resumes refresh after its initial loading draw fails', async () => {
    await boot({ routes: [route] })
    const pending = deferred<Trip[]>()
    const error = new Error('loading display unavailable')
    mocks.trips.mockReturnValueOnce(pending.promise)
    mocks.bridge.textContainerUpgrade.mockRejectedValueOnce(error)
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(console.error).toHaveBeenCalledWith(error)
    expect(mocks.trips).toHaveBeenCalledOnce()
    pending.resolve([trip({ legs: [leg({ originTrack: '12' })] })])
    await flush()
    expect(api.state.detailStatus).toBe('ready')
    expect(api.state.detailTrips).toHaveLength(1)
    expect(lens()).not.toContain('Loading times...')
    gesture(OsEventTypeList.CLICK_EVENT, true)
    await flush()
    expect(lens()).toContain('Platform: 12')
    mocks.trips.mockResolvedValueOnce([trip({ legs: [leg({ originTrack: '19' })] })])
    await api.refreshOpenTrips()
    expect(mocks.trips).toHaveBeenCalledTimes(2)
    expect(api.state.detailStatus).toBe('ready')
    expect(element('#results').innerHTML).toBe('')
    expect(lens()).toContain('Platform: 19')
  })

  it('keeps the phone detail scroll position during a valid refresh', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    click('#results .trip-card')
    element('#detail').scrollTop = 180
    const updated = trip({ legs: [leg({ originTrack: '19', departureDelayMin: 8 })] })
    mocks.trips.mockResolvedValueOnce([updated])
    await api.refreshOpenTrips()
    expect(element('#detail').hidden).toBe(false)
    expect(element('#stops').hidden).toBe(true)
    expect(element('#detail').scrollTop).toBe(180)
    expect(element('#detail').textContent).toContain('19')
  })

  it('preserves open full stops, focus, and detail scroll when the same itinerary refreshes', async () => {
    await boot({ routes: [route] })
    click('#saved .chip')
    await flush()
    click('#results .trip-card')
    element('#detail').scrollTop = 180
    mocks.journey.mockResolvedValueOnce([stop('Before'), stop(route.fromName), stop('Intermediate'), stop(route.toName), stop('After')])
    click('.leg-service--tap')
    await flush()
    const stops = element('#stops').innerHTML
    const back = element('#stops-back')
    back.focus()
    const updated = trip({ legs: [leg({ originTrack: '19', departureDelayMin: 8 })] })
    mocks.trips.mockResolvedValueOnce([updated])
    await api.refreshOpenTrips()
    expect(api.state.phoneDetailTrip).toBe(updated)
    expect(element('#stops').hidden).toBe(false)
    expect(element('#stops').innerHTML).toBe(stops)
    expect(document.activeElement).toBe(back)
    expect(element('#detail').scrollTop).toBe(180)
    expect(element('#detail').textContent).toContain('19')
    expect(element('#results .selected').dataset.idx).toBe('0')
    expect(lens()).toContain('Platform: 19')
    click('#stops-back')
    expect(element('#stops').hidden).toBe(true)
    expect(element('#detail').hidden).toBe(false)
  })
})
