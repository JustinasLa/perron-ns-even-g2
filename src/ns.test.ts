import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBoard, fetchJourney, fetchStations, fetchTrips } from './ns'

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true
  const status = init.status ?? 200
  return {
    ok,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response
}

type Route = { match: string; value: Response | Error }

function mockFetch(routes: Route[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      for (const route of routes) {
        if (url.includes(route.match)) {
          if (route.value instanceof Error) {
            throw route.value
          }
          return route.value
        }
      }
      throw new Error('no mock route for ' + url)
    }),
  )
}

function lastFetchUrl(): string {
  const mock = fetch as unknown as { mock: { calls: unknown[][] } }
  const calls = mock.mock.calls
  return String(calls[calls.length - 1][0])
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchTrips', () => {
  it('parses a direct train trip and maps the core fields', async () => {
    mockFetch([
      {
        match: '/v3/trips',
        value: jsonResponse({
          trips: [
            {
              status: 'NORMAL',
              transfers: 0,
              plannedDurationInMinutes: 38,
              actualDurationInMinutes: 41,
              crowdForecast: 'MEDIUM',
              legs: [
                {
                  name: 'IC 1429',
                  direction: 'Amsterdam Centraal',
                  product: {
                    type: 'TRAIN',
                    categoryCode: 'IC',
                    displayName: 'Intercity',
                    operatorName: 'NS',
                  },
                  origin: {
                    name: 'Utrecht Centraal',
                    plannedTrack: '5',
                    actualTrack: '7',
                    plannedDateTime: '2026-06-29T10:00:00+0200',
                    actualDateTime: '2026-06-29T10:02:00+0200',
                  },
                  destination: {
                    name: 'Amsterdam Centraal',
                    plannedTrack: '11',
                    plannedDateTime: '2026-06-29T10:38:00+0200',
                    actualDateTime: '2026-06-29T10:41:00+0200',
                    exitSide: 'LEFT',
                  },
                  crowdForecast: 'HIGH',
                  stops: [{}, {}, {}, {}],
                },
              ],
            },
          ],
        }),
      },
    ])

    const trips = await fetchTrips('UT', 'ASD')

    expect(trips).toHaveLength(1)
    const trip = trips[0]
    expect(trip.status).toBe('NORMAL')
    expect(trip.transfers).toBe(0)
    expect(trip.durationMin).toBe(41) // actual preferred over planned
    expect(trip.crowd).toBe('MEDIUM')
    expect(trip.cancelled).toBe(false)
    expect(trip.departure).toBe('2026-06-29T10:00:00+0200') // first leg planned departure
    expect(trip.arrival).toBe('2026-06-29T10:38:00+0200') // last leg planned arrival

    expect(trip.legs).toHaveLength(1)
    const leg = trip.legs[0]
    expect(leg.mode).toBe('TRAIN')
    expect(leg.service).toBe('IC 1429')
    expect(leg.category).toBe('IC')
    expect(leg.displayName).toBe('Intercity')
    expect(leg.operator).toBe('NS')
    expect(leg.direction).toBe('Amsterdam Centraal')
    expect(leg.origin).toBe('Utrecht Centraal')
    expect(leg.destination).toBe('Amsterdam Centraal')
    expect(leg.originTrack).toBe('7') // actualTrack preferred over plannedTrack
    expect(leg.destinationTrack).toBe('11') // falls back to plannedTrack
    expect(leg.departureDelayMin).toBe(2)
    expect(leg.arrivalDelayMin).toBe(3)
    expect(leg.crowd).toBe('HIGH')
    expect(leg.exitSide).toBe('LEFT')
    expect(leg.intermediateStops).toBe(2) // stops.length (4) - 2
  })

  it('parses the per-leg stop list and skips passing (non-stopping) stops', async () => {
    mockFetch([
      {
        match: '/v3/trips',
        value: jsonResponse({
          trips: [
            {
              legs: [
                {
                  name: 'IC 713',
                  direction: 'Groningen',
                  origin: { name: 'Lelystad Centrum', plannedDateTime: '2026-06-29T05:48:00+0200' },
                  destination: { name: 'Groningen', plannedDateTime: '2026-06-29T07:12:00+0200' },
                  stops: [
                    {
                      name: 'Lelystad Centrum',
                      plannedDepartureDateTime: '2026-06-29T05:48:00+0200',
                      plannedDepartureTrack: '2',
                    },
                    {
                      name: 'Dronten',
                      passing: true,
                    },
                    {
                      name: 'Zwolle',
                      plannedArrivalDateTime: '2026-06-29T06:14:00+0200',
                      plannedDepartureDateTime: '2026-06-29T06:15:00+0200',
                      actualDepartureDateTime: '2026-06-29T06:16:00+0200',
                      actualDepartureTrack: '7',
                    },
                    {
                      name: 'Groningen',
                      plannedArrivalDateTime: '2026-06-29T07:12:00+0200',
                      plannedArrivalTrack: '4a',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ])

    const leg = (await fetchTrips('LLS', 'GN'))[0].legs[0]
    expect(leg.stops.map((s) => s.name)).toEqual(['Lelystad Centrum', 'Zwolle', 'Groningen'])
    expect(leg.intermediateStops).toBe(1)
    expect(leg.stops[0].track).toBe('2')
    expect(leg.stops[1].departureDelayMin).toBe(1) // actual 06:16 vs planned 06:15
    expect(leg.stops[1].track).toBe('7') // actual departure track preferred
    expect(leg.stops[2].track).toBe('4a') // falls back to planned arrival track
  })

  it('clamps negative delays to zero (early trains are not "negative delay")', async () => {
    mockFetch([
      {
        match: '/v3/trips',
        value: jsonResponse({
          trips: [
            {
              legs: [
                {
                  name: 'SPR 1234',
                  origin: {
                    name: 'A',
                    plannedDateTime: '2026-06-29T10:00:00+0200',
                    actualDateTime: '2026-06-29T09:58:00+0200', // 2 min early
                  },
                  destination: {
                    name: 'B',
                    plannedDateTime: '2026-06-29T10:20:00+0200',
                    actualDateTime: '2026-06-29T10:20:00+0200',
                  },
                },
              ],
            },
          ],
        }),
      },
    ])

    const trips = await fetchTrips('A', 'B')
    expect(trips[0].legs[0].departureDelayMin).toBe(0)
    expect(trips[0].legs[0].arrivalDelayMin).toBe(0)
  })

  it('marks the trip cancelled when status is CANCELLED and surfaces a reason from messages', async () => {
    mockFetch([
      {
        match: '/v3/trips',
        value: jsonResponse({
          trips: [
            {
              status: 'CANCELLED',
              messages: [{ text: 'Train cancelled due to a defective train' }],
              legs: [
                {
                  name: 'IC 100',
                  cancelled: true,
                  origin: { name: 'A', plannedDateTime: '2026-06-29T10:00:00+0200' },
                  destination: { name: 'B', plannedDateTime: '2026-06-29T10:30:00+0200' },
                },
              ],
            },
          ],
        }),
      },
    ])

    const trips = await fetchTrips('A', 'B')
    expect(trips[0].cancelled).toBe(true)
    expect(trips[0].cancellationReason).toBe('Train cancelled due to a defective train')
  })

  it('marks the trip cancelled when a leg is cancelled even if trip status is normal', async () => {
    mockFetch([
      {
        match: '/v3/trips',
        value: jsonResponse({
          trips: [
            {
              status: 'NORMAL',
              legs: [
                {
                  name: 'IC 100',
                  cancelled: true,
                  messages: [{ head: 'Rijdt niet' }],
                  origin: { name: 'A', plannedDateTime: '2026-06-29T10:00:00+0200' },
                  destination: { name: 'B', plannedDateTime: '2026-06-29T10:30:00+0200' },
                },
              ],
            },
          ],
        }),
      },
    ])

    const trips = await fetchTrips('A', 'B')
    expect(trips[0].cancelled).toBe(true)
    expect(trips[0].cancellationReason).toBe('Rijdt niet') // pulled from leg messages, .head field
  })

  it('classifies leg travel modes (walk, bus, tram, metro, ferry, train)', async () => {
    mockFetch([
      {
        match: '/v3/trips',
        value: jsonResponse({
          trips: [
            {
              transfers: 5,
              legs: [
                { name: 'Walk', travelType: 'WALK', origin: { name: 'A' }, destination: { name: 'B' } },
                { name: 'Bus 50', product: { type: 'BUS' }, origin: { name: 'B' }, destination: { name: 'C' } },
                { name: 'Tram 2', product: { type: 'TRAM' }, origin: { name: 'C' }, destination: { name: 'D' } },
                { name: 'Metro 51', product: { type: 'METRO' }, origin: { name: 'D' }, destination: { name: 'E' } },
                { name: 'Veerboot', product: { displayName: 'Veerdienst' }, origin: { name: 'E' }, destination: { name: 'F' } },
                { name: 'IC 1429', product: { type: 'TRAIN' }, origin: { name: 'F' }, destination: { name: 'G' } },
              ],
            },
          ],
        }),
      },
    ])

    const modes = (await fetchTrips('A', 'G'))[0].legs.map((l) => l.mode)
    expect(modes).toEqual(['WALK', 'BUS', 'TRAM', 'METRO', 'FERRY', 'TRAIN'])
  })

  it('returns an empty array when the payload has no trips', async () => {
    mockFetch([{ match: '/v3/trips', value: jsonResponse({}) }])
    expect(await fetchTrips('A', 'B')).toEqual([])
  })

  it('builds the request URL with encoded params and includes dateTime/arrival when given', async () => {
    mockFetch([{ match: '/v3/trips', value: jsonResponse({ trips: [] }) }])
    await fetchTrips('UT', 'ASD', { dateTime: '2026-06-29T10:00:00+0200', searchForArrival: true, lang: 'nl' })

    const url = lastFetchUrl()
    expect(url).toContain('lang=nl')
    expect(url).toContain('fromStation=UT')
    expect(url).toContain('toStation=ASD')
    expect(url).toContain('dateTime=' + encodeURIComponent('2026-06-29T10:00:00+0200'))
    expect(url).toContain('searchForArrival=true')
  })

  it('throws an informative error when the proxy returns a non-OK status', async () => {
    mockFetch([
      { match: '/v3/trips', value: jsonResponse('upstream rate limited', { ok: false, status: 429 }) },
    ])
    await expect(fetchTrips('A', 'B')).rejects.toThrow('NS 429: upstream rate limited')
  })
})

describe('fetchJourney', () => {
  it('parses a full train route, skips passing stops, and maps times/tracks/delays', async () => {
    mockFetch([
      {
        match: '/v2/journey',
        value: jsonResponse({
          payload: {
            stops: [
              {
                stop: { name: 'Lelystad Centrum' },
                status: 'ORIGIN',
                departures: [{ plannedTime: '2026-06-29T05:48:00+0200', plannedTrack: '2' }],
              },
              {
                stop: { name: 'Dronten' },
                status: 'PASSING',
              },
              {
                stop: { name: 'Zwolle' },
                status: 'STOP',
                arrivals: [{ plannedTime: '2026-06-29T06:14:00+0200' }],
                departures: [
                  {
                    plannedTime: '2026-06-29T06:15:00+0200',
                    actualTime: '2026-06-29T06:16:00+0200',
                    actualTrack: '7',
                  },
                ],
              },
              {
                stop: { name: 'Groningen' },
                status: 'DESTINATION',
                arrivals: [{ plannedTime: '2026-06-29T07:12:00+0200', plannedTrack: '4a' }],
              },
            ],
          },
        }),
      },
    ])

    const stops = await fetchJourney('713', { dateTime: '2026-06-29T06:15:00+0200' })
    expect(stops.map((s) => s.name)).toEqual(['Lelystad Centrum', 'Zwolle', 'Groningen'])
    expect(stops[0].track).toBe('2')
    expect(stops[1].departureDelayMin).toBe(1) // actual 06:16 vs planned 06:15
    expect(stops[1].track).toBe('7') // actual departure track preferred
    expect(stops[2].track).toBe('4a') // falls back to planned arrival track

    const url = lastFetchUrl()
    expect(url).toContain('/v2/journey')
    expect(url).toContain('train=713')
    expect(url).toContain('dateTime=' + encodeURIComponent('2026-06-29T06:15:00+0200'))
  })

  it('returns an empty array when the journey payload has no stops', async () => {
    mockFetch([{ match: '/v2/journey', value: jsonResponse({ payload: {} }) }])
    expect(await fetchJourney('713')).toEqual([])
  })
})

describe('fetchBoard', () => {
  it('parses departures with delay, track change and cancellation flags', async () => {
    mockFetch([
      {
        match: '/v2/departures',
        value: jsonResponse({
          payload: {
            departures: [
              {
                direction: 'Den Haag Centraal',
                plannedDateTime: '2026-06-29T10:00:00+0200',
                actualDateTime: '2026-06-29T10:05:00+0200',
                plannedTrack: '5',
                actualTrack: '8',
              },
              {
                direction: 'Eindhoven Centraal',
                plannedDateTime: '2026-06-29T10:10:00+0200',
                plannedTrack: '3',
                cancelled: true,
              },
            ],
          },
        }),
      },
      { match: '/v3/disruptions', value: jsonResponse([]) },
    ])

    const board = await fetchBoard('UT')
    expect(board.departures).toHaveLength(2)

    const first = board.departures[0]
    expect(first.destination).toBe('Den Haag Centraal')
    expect(first.delayMin).toBe(5)
    expect(first.track).toBe('8') // actualTrack preferred
    expect(first.trackChanged).toBe(true)
    expect(first.cancelled).toBe(false)

    const second = board.departures[1]
    expect(second.delayMin).toBe(0) // no actualDateTime -> falls back to planned
    expect(second.track).toBe('3')
    expect(second.trackChanged).toBe(false)
    expect(second.cancelled).toBe(true)
  })

  it('keeps active disruptions and drops inactive ones', async () => {
    mockFetch([
      { match: '/v2/departures', value: jsonResponse({ payload: { departures: [] } }) },
      {
        match: '/v3/disruptions',
        value: jsonResponse([
          { type: 'MAINTENANCE', title: 'Track work near Utrecht', isActive: true },
          { topic: 'Old disruption', isActive: false },
          { topic: 'Signal failure' }, // isActive omitted -> kept
        ]),
      },
    ])

    const board = await fetchBoard('UT')
    expect(board.disruptions).toEqual([
      { type: 'MAINTENANCE', title: 'Track work near Utrecht' },
      { type: 'DISRUPTION', title: 'Signal failure' }, // default type, title from topic
    ])
  })

  it('still returns departures when the disruptions endpoint fails', async () => {
    mockFetch([
      {
        match: '/v2/departures',
        value: jsonResponse({
          payload: {
            departures: [
              { direction: 'Zwolle', plannedDateTime: '2026-06-29T10:00:00+0200', plannedTrack: '1' },
            ],
          },
        }),
      },
      { match: '/v3/disruptions', value: new Error('network down') },
    ])

    const board = await fetchBoard('UT')
    expect(board.departures).toHaveLength(1)
    expect(board.disruptions).toEqual([])
  })
})

describe('fetchStations', () => {
  it('maps station names, country and synonyms with fallbacks', async () => {
    mockFetch([
      {
        match: '/v2/stations',
        value: jsonResponse({
          payload: [
            {
              code: 'UT',
              namen: { lang: 'Utrecht Centraal', middel: 'Utrecht C.' },
              land: 'NL',
              synoniemen: ['Utrecht CS'],
            },
            {
              code: 'ASB',
              namen: { middel: 'Amsterdam Bijlmer' }, // no long name -> use middel
              land: 'NL',
            },
            { code: 'XX' }, // no names at all -> fall back to code
          ],
        }),
      },
    ])

    const stations = await fetchStations()
    expect(stations).toEqual([
      { code: 'UT', name: 'Utrecht Centraal', country: 'NL', synonyms: ['Utrecht CS'] },
      { code: 'ASB', name: 'Amsterdam Bijlmer', country: 'NL', synonyms: [] },
      { code: 'XX', name: 'XX', country: '', synonyms: [] },
    ])
  })
})

describe('NS response edge cases', () => {
  it.each([null, {}])('handles an absent top-level payload: %j', async (data) => {
    mockFetch([
      { match: '/v3/trips', value: jsonResponse(data) },
      { match: '/v2/journey', value: jsonResponse(data) },
      { match: '/v2/stations', value: jsonResponse(data) },
      { match: '/v2/departures', value: jsonResponse(data) },
      { match: '/v3/disruptions', value: jsonResponse(data) },
    ])
    expect(await fetchTrips('A', 'B')).toEqual([])
    expect(await fetchJourney('1')).toEqual([])
    expect(await fetchStations()).toEqual([])
    expect(await fetchBoard('A')).toEqual({ departures: [], disruptions: [] })
  })

  it('handles empty, missing, and non-array stop collections', async () => {
    mockFetch([{ match: '/v3/trips', value: jsonResponse({ trips: [{}, { legs: [{}] }, { legs: [{ stops: [] }] }] }) }])
    const trips = await fetchTrips('A', 'B')
    expect(trips[0]).toEqual({ departure: '', arrival: '', durationMin: 0, transfers: 0, status: 'NORMAL', cancelled: false, cancellationReason: '', crowd: 'UNKNOWN', legs: [] })
    expect(trips[1].legs[0]).toMatchObject({ service: '', category: '', displayName: '', trainNumber: '', origin: '', destination: '', departure: '', arrival: '', originTrack: '', destinationTrack: '', durationMin: 0, intermediateStops: 0, stops: [], walkToNextMin: null })
    expect(trips[2].legs[0].intermediateStops).toBe(0)
    mockFetch([{ match: '/v2/journey', value: jsonResponse({ payload: { stops: {} } }) }])
    expect(await fetchJourney('1', { lang: 'nl' })).toEqual([])
    expect(lastFetchUrl()).toContain('lang=nl')
  })

  it('uses actual-only times, planned duration, train numbers, and arrival tracks', async () => {
    const time = '2026-06-29T10:00:00Z'
    mockFetch([{ match: '/v3/trips', value: jsonResponse({ trips: [{ plannedDurationInMinutes: 20, legs: [
      { product: { displayName: 'Sprinter', number: 123 }, actualDurationInMinutes: 21, transferTimeToNextLeg: 4, origin: { plannedTrack: '1', actualDateTime: time }, destination: { actualTrack: '2', actualDateTime: time }, stops: [{ actualArrivalDateTime: time, actualDepartureDateTime: time, actualArrivalTrack: '3', cancelled: true }] },
      { name: ' IC', plannedDurationInMinutes: 20 },
    ] }] }) }])
    const trip = (await fetchTrips('A', 'B'))[0]
    expect(trip.durationMin).toBe(20)
    expect(trip.legs[0]).toMatchObject({ service: 'Sprinter', trainNumber: '123', departure: time, arrival: time, originTrack: '1', destinationTrack: '2', durationMin: 21, walkToNextMin: 4 })
    expect(trip.legs[0].stops[0]).toMatchObject({ arrival: time, departure: time, track: '3', cancelled: true })
    expect(trip.legs[1]).toMatchObject({ category: '', durationMin: 20 })
  })

  it.each([
    ['plain reason', 'plain reason'],
    [{ message: 'Message reason' }, 'Message reason'],
    [{ title: 'Title reason' }, 'Title reason'],
    [null, ''],
    [{}, ''],
    ['   ', ''],
  ])('reads cancellation message shape %j', async (message, expected) => {
    mockFetch([{ match: '/v3/trips', value: jsonResponse({ trips: [{ status: 'CANCELLED', messages: [message] }] }) }])
    expect((await fetchTrips('A', 'B'))[0].cancellationReason).toBe(expected)
  })

  it.each([
    [{ product: { type: 'WALK' } }, 'WALK'],
    [{ product: { displayName: 'Walk to platform' } }, 'WALK'],
    [{ name: 'Lopen' }, 'WALK'],
    [{ product: { type: 'SUBWAY' } }, 'METRO'],
    [{ product: { type: 'FERRY' } }, 'FERRY'],
    [{ product: { displayName: 'Boot' } }, 'FERRY'],
    [{ product: { displayName: 'Veer' } }, 'FERRY'],
    [{ travelType: 'PUBLIC_TRANSIT' }, 'TRAIN'],
  ])('recognizes travel mode for %j', async (leg, expected) => {
    mockFetch([{ match: '/v3/trips', value: jsonResponse({ trips: [{ legs: [leg] }] }) }])
    expect((await fetchTrips('A', 'B'))[0].legs[0].mode).toBe(expected)
  })

  it('encodes station codes and ignores arrival search without a date', async () => {
    mockFetch([{ match: '/v3/trips', value: jsonResponse({ trips: [] }) }])
    await fetchTrips('A & B', 'C/D', { searchForArrival: true })
    expect(lastFetchUrl()).toContain('fromStation=A%20%26%20B&toStation=C%2FD')
    expect(lastFetchUrl()).not.toContain('searchForArrival')
    await fetchTrips('A', 'B', { dateTime: '2026-06-29T10:00:00Z' })
    expect(lastFetchUrl()).toContain('dateTime=')
    expect(lastFetchUrl()).not.toContain('searchForArrival')
  })

  it('limits error text to 80 characters', async () => {
    mockFetch([{ match: '/v3/trips', value: jsonResponse('x'.repeat(100), { ok: false, status: 500 }) }])
    await expect(fetchTrips('A', 'B')).rejects.toHaveProperty('message', 'NS 500: ' + 'x'.repeat(80))
  })

  it.each([false, true])('reports status even when error body is unreadable: %s', async (rejectBody) => {
    const response = jsonResponse('', { ok: false, status: 503 })
    if (rejectBody) response.text = async () => { throw new Error('unreadable') }
    mockFetch([{ match: '/v3/trips', value: response }])
    await expect(fetchTrips('A', 'B')).rejects.toThrow('NS 503')
  })

  it('uses actual-only journey times and arrival tracks and handles missing entries', async () => {
    const time = '2026-06-29T10:00:00Z'
    mockFetch([{ match: '/v2/journey', value: jsonResponse({ payload: { stops: [
      { arrivals: [{ actualTime: time, actualTrack: '2', cancelled: true }], departures: [{ actualTime: time }] },
      { stop: {}, arrivals: [], departures: [{ cancelled: true }] },
      {},
    ] } }) }])
    const stops = await fetchJourney('IC & 1')
    expect(stops[0]).toMatchObject({ name: '', arrival: time, departure: time, track: '2', cancelled: true })
    expect(stops[1]).toMatchObject({ track: '', cancelled: true })
    expect(stops[2]).toEqual({ name: '', arrival: '', departure: '', track: '', arrivalDelayMin: 0, departureDelayMin: 0, cancelled: false })
    expect(lastFetchUrl()).toContain('train=IC%20%26%201')
  })

  it('handles early departures, missing tracks, status cancellations, and wrapped disruptions', async () => {
    mockFetch([
      { match: '/v2/departures', value: jsonResponse({ payload: { departures: [
        { direction: 'A', plannedDateTime: '2026-06-29T10:00:00Z', actualDateTime: '2026-06-29T09:59:00Z', departureStatus: 'CANCELLED' },
        { direction: 'B', actualDateTime: '2026-06-29T10:01:00Z', actualTrack: '2' },
        { direction: 'C', plannedDateTime: '2026-06-29T10:00:00Z', actualTrack: '3', plannedTrack: '3' },
      ] } }) },
      { match: '/v3/disruptions', value: jsonResponse({ payload: [{}] }) },
    ])
    const board = await fetchBoard('A/B')
    expect(board.departures[0]).toMatchObject({ delayMin: 0, track: '?', cancelled: true })
    expect(board.departures[1]).toMatchObject({ time: '2026-06-29T10:01:00Z', delayMin: 0, track: '2', trackChanged: false })
    expect(board.departures[2].trackChanged).toBe(false)
    expect(board.disruptions).toEqual([{ type: 'DISRUPTION', title: 'Storing' }])
  })
})
