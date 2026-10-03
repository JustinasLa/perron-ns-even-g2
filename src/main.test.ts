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
  it('ranks names, codes, and synonyms and limits suggestions to seven', async () => {
    await boot()
    expect(api.rankStations('ams').map((s: StationInfo) => s.code)).toEqual(['AMS5', 'AMS4', 'AMS3', 'AMS2', 'ASA', 'ASD', 'AMS'])
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
    expect(element<HTMLInputElement>('#from').dataset.code).toBe('AMS5')
    input('#from', 'ut')
    key('#from', 'Enter')
    expect(element<HTMLInputElement>('#from').dataset.code).toBe('UT')
    input('#to', 'ams')
    const option = element('#to-list .option')
    option.dispatchEvent(new MouseEvent('mouseenter'))
    expect(option.classList.contains('active')).toBe(true)
    option.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }))
    expect(element<HTMLInputElement>('#to').dataset.code).toBe('AMS5')
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
    expect(api.state.favorites).toHaveLength(1)
    expect(element<HTMLInputElement>('#from').dataset.code).toBeUndefined()
    star.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(api.state.favorites).toHaveLength(0)
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
    api.state.detailTrips = [trip({ legs: [], cancelled: true }), trip({ cancelled: true, cancellationReason: 'Track work', legs: [leg({ mode: 'BUS', originTrack: '', destinationTrack: '' }), leg({ mode: 'OTHER', departure: '2026-10-02T10:40:00Z' })] })]
    api.state.tripIdx = 9
    expect(api.listContent()).toContain('CANCELLED')
    expect(api.state.tripIdx).toBe(1)
    expect(api.detailContent()).toContain('CANCELLED — Track work')
    expect(api.detailContent()).toContain('Bus · Trip:')
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
    expect(api.detailContent()).toContain('Change (5 min)')
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
    expect(api.gapMinutes('2026-10-02T10:00:00Z', '2026-10-02T09:00:00Z')).toBe(0)
    expect(api.fmtDateHeader(new Date().toISOString())).toContain('Today,')
    expect(api.fmtDateHeader('2026-01-01T12:00:00Z')).not.toContain('Today')
    for (const [mode, label] of [['BUS', 'Bus'], ['TRAM', 'Tram'], ['METRO', 'Metro'], ['FERRY', 'Ferry'], ['WALK', 'Walk'], ['OTHER', '']]) {
      expect(api.modeLabel(mode)).toBe(label)
      expect(api.legBadgeLabel(leg({ mode: mode as TripLeg['mode'], category: '' }))).toBe(label || 'Train')
    }
    for (const crowd of ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']) {
      expect(api.crowdInline(crowd)).toContain('ctext--' + crowd.toLowerCase())
      expect(api.crowdBadge(crowd)).toEqual(crowd === 'UNKNOWN' ? '' : expect.stringContaining('crowd--' + crowd.toLowerCase()))
    }
    expect(api.serviceBadges([leg({ mode: 'WALK' }), leg({ mode: 'BUS', category: '' })])).toContain('Bus')
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

  it('renders leg stops, transfer waits, changed operators, and walk-only routes', async () => {
    await boot()
    const first = leg({ operator: 'NS Rail', arrival: '2026-10-02T10:00:00Z', walkToNextMin: 3 })
    const next = leg({ operator: 'Arriva Rail', departure: '2026-10-02T10:10:00Z', originTrack: '9' })
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
    vi.spyOn(api.state.detailView, 'querySelectorAll').mockReturnValueOnce([invalid])
    api.showDetail(trip())
    expect(element('#detail').hidden).toBe(false)
    expect(element('#stops').hidden).toBe(true)
    click('#detail-back')
    expect(element('#detail').hidden).toBe(true)
    expect(api.state.view).toBe('home')
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
    api.state.detailTrips = [trip()]
    await renderingFailure(() => api.mirrorDetailToLens(0))
    await renderingFailure(() => api.applyLanguage())
    api.showDetail(trip(), 0)
    await flush()
    await renderingFailure(() => click('#detail-back'))
    mocks.bridge.textContainerUpgrade.mockRejectedValueOnce(new Error('clock unavailable'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'clock unavailable' }))
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
    api.state.view = 'list'
    await renderingFailure(() => api.commitTime())
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
    expect(element('#detail .leg-service-name').textContent).toBe(displayName)
    expect(element('#detail .leg-service-dir').textContent).toContain(direction)
    expect(Array.from(element('#detail').querySelectorAll('.platform'), el => el.textContent)).toEqual([originTrack, destinationTrack])
    expect(element('#detail').querySelector('img, b, [onerror]')).toBeNull()
    click('#detail .leg-service--tap')
    expect(Array.from(element('#stops').querySelectorAll('.stop-name'), el => el.textContent)).toEqual(partial.map(s => s.name))
    await flush()
    expect(element('#stops .detail-title-main').textContent).toBe(displayName)
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
