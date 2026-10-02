const BASE = 'https://perron-ns-proxy.justinasla.workers.dev'

export interface Departure {
  destination: string
  time: string
  delayMin: number
  track: string
  trackChanged: boolean
  cancelled: boolean
}

export interface Disruption {
  type: string
  title: string
}

export interface Board {
  departures: Departure[]
  disruptions: Disruption[]
}

async function getJSON(url: string): Promise<any> {
  const response = await fetch(url)
  if (!response.ok) {
    let body = ''
    try {
      body = await response.text()
    } catch {
      body = ''
    }
    let extra = ''
    if (body) {
      extra = ': ' + body.slice(0, 80)
    }
    throw new Error('NS ' + response.status + extra)
  }
  return response.json()
}

export type TravelMode = 'TRAIN' | 'BUS' | 'TRAM' | 'METRO' | 'FERRY' | 'WALK' | 'OTHER'

export interface LegStop {
  name: string
  arrival: string
  departure: string
  arrivalDelayMin: number
  departureDelayMin: number
  track: string
  cancelled: boolean
}

export interface TripLeg {
  service: string
  mode: TravelMode
  category: string
  displayName: string
  operator: string
  trainNumber: string
  direction: string
  origin: string
  originTrack: string
  destination: string
  destinationTrack: string
  departure: string
  departureDelayMin: number
  arrival: string
  arrivalDelayMin: number
  durationMin: number
  crowd: string
  intermediateStops: number
  stops: LegStop[]
  exitSide: string
  walkToNextMin: number | null
  cancelled: boolean
}

export interface Trip {
  departure: string
  arrival: string
  durationMin: number
  transfers: number
  status: string
  cancelled: boolean
  cancellationReason: string
  crowd: string
  legs: TripLeg[]
}

function messageText(m: any): string {
  if (!m) {
    return ''
  }
  if (typeof m === 'string') {
    return m
  }
  if (m.text) {
    return m.text
  }
  if (m.message) {
    return m.message
  }
  if (m.head) {
    return m.head
  }
  if (m.title) {
    return m.title
  }
  return ''
}

function delay(planned: string | undefined, actual: string | undefined): number {
  if (!planned || !actual) {
    return 0
  }
  const diff = (new Date(actual).getTime() - new Date(planned).getTime()) / 60000
  let rounded = Math.round(diff)
  if (rounded < 0) {
    rounded = 0
  }
  return rounded
}

function parseStops(rawStops: any): LegStop[] {
  const stops: LegStop[] = []
  if (!Array.isArray(rawStops)) {
    return stops
  }
  for (const s of rawStops) {
    if (s.passing) {
      continue
    }
    let name = ''
    if (s.name) {
      name = s.name
    }
    let arrival = ''
    if (s.plannedArrivalDateTime) {
      arrival = s.plannedArrivalDateTime
    } else if (s.actualArrivalDateTime) {
      arrival = s.actualArrivalDateTime
    }
    let departure = ''
    if (s.plannedDepartureDateTime) {
      departure = s.plannedDepartureDateTime
    } else if (s.actualDepartureDateTime) {
      departure = s.actualDepartureDateTime
    }
    let track = ''
    if (s.actualDepartureTrack) {
      track = s.actualDepartureTrack
    } else if (s.plannedDepartureTrack) {
      track = s.plannedDepartureTrack
    } else if (s.actualArrivalTrack) {
      track = s.actualArrivalTrack
    } else if (s.plannedArrivalTrack) {
      track = s.plannedArrivalTrack
    }
    let cancelled = false
    if (s.cancelled) {
      cancelled = true
    }
    stops.push({
      name: name,
      arrival: arrival,
      departure: departure,
      arrivalDelayMin: delay(s.plannedArrivalDateTime, s.actualArrivalDateTime),
      departureDelayMin: delay(s.plannedDepartureDateTime, s.actualDepartureDateTime),
      track: track,
      cancelled: cancelled,
    })
  }
  return stops
}

function firstEntry(arr: any): any {
  if (Array.isArray(arr) && arr.length > 0) {
    return arr[0]
  }
  return {}
}

function parseJourneyStops(rawStops: any): LegStop[] {
  const stops: LegStop[] = []
  if (!Array.isArray(rawStops)) {
    return stops
  }
  for (const s of rawStops) {
    if (s.status === 'PASSING') {
      continue
    }
    let name = ''
    if (s.stop && s.stop.name) {
      name = s.stop.name
    }
    const arr = firstEntry(s.arrivals)
    const dep = firstEntry(s.departures)
    let arrival = ''
    if (arr.plannedTime) {
      arrival = arr.plannedTime
    } else if (arr.actualTime) {
      arrival = arr.actualTime
    }
    let departure = ''
    if (dep.plannedTime) {
      departure = dep.plannedTime
    } else if (dep.actualTime) {
      departure = dep.actualTime
    }
    let track = ''
    if (dep.actualTrack) {
      track = dep.actualTrack
    } else if (dep.plannedTrack) {
      track = dep.plannedTrack
    } else if (arr.actualTrack) {
      track = arr.actualTrack
    } else if (arr.plannedTrack) {
      track = arr.plannedTrack
    }
    let cancelled = false
    if (arr.cancelled || dep.cancelled) {
      cancelled = true
    }
    stops.push({
      name: name,
      arrival: arrival,
      departure: departure,
      arrivalDelayMin: delay(arr.plannedTime, arr.actualTime),
      departureDelayMin: delay(dep.plannedTime, dep.actualTime),
      track: track,
      cancelled: cancelled,
    })
  }
  return stops
}

function legMode(l: any): TravelMode {
  let travelType = ''
  if (l.travelType) {
    travelType = String(l.travelType).toUpperCase()
  }
  if (travelType === 'WALK') {
    return 'WALK'
  }

  let raw = ''
  if (l.product && l.product.type) {
    raw = String(l.product.type).toUpperCase()
  }
  let categoryCode = ''
  if (l.product && l.product.categoryCode) {
    categoryCode = l.product.categoryCode
  }
  let displayName = ''
  if (l.product && l.product.displayName) {
    displayName = l.product.displayName
  } else if (l.name) {
    displayName = l.name
  }

  const text = (raw + ' ' + categoryCode + ' ' + displayName).toUpperCase()
  if (raw === 'WALK' || text.includes('WALK') || text.includes('LOPEN')) {
    return 'WALK'
  }
  if (text.includes('BUS')) {
    return 'BUS'
  }
  if (text.includes('TRAM')) {
    return 'TRAM'
  }
  if (text.includes('METRO') || text.includes('SUBWAY')) {
    return 'METRO'
  }
  if (text.includes('FERRY') || text.includes('BOOT') || text.includes('VEER')) {
    return 'FERRY'
  }
  return 'TRAIN'
}

export interface TripOptions {
  dateTime?: string
  searchForArrival?: boolean
  lang?: string
}

export async function fetchTrips(
  fromCode: string,
  toCode: string,
  opts: TripOptions = {},
): Promise<Trip[]> {
  let lang = 'en'
  if (opts.lang) {
    lang = opts.lang
  }
  let url =
    BASE +
    '/v3/trips?lang=' +
    encodeURIComponent(lang) +
    '&fromStation=' +
    encodeURIComponent(fromCode) +
    '&toStation=' +
    encodeURIComponent(toCode)
  if (opts.dateTime) {
    url += '&dateTime=' + encodeURIComponent(opts.dateTime)
    if (opts.searchForArrival) {
      url += '&searchForArrival=true'
    }
  }
  const data = await getJSON(url)

  let rawTrips: any[] = []
  if (data && data.trips) {
    rawTrips = data.trips
  }

  const trips: Trip[] = []
  for (const t of rawTrips) {
    let rawLegs: any[] = []
    if (t.legs) {
      rawLegs = t.legs
    }

    const legs: TripLeg[] = []
    for (const l of rawLegs) {
      let o: any = {}
      if (l.origin) {
        o = l.origin
      }
      let d: any = {}
      if (l.destination) {
        d = l.destination
      }

      let service = ''
      if (l.name) {
        service = l.name
      } else if (l.product && l.product.displayName) {
        service = l.product.displayName
      }

      let category = ''
      if (l.product && l.product.categoryCode) {
        category = l.product.categoryCode
      } else if (l.name) {
        const firstWord = l.name.split(' ')[0]
        if (firstWord) {
          category = firstWord
        }
      }

      let displayName = ''
      if (l.product && l.product.displayName) {
        displayName = l.product.displayName
      } else if (l.name) {
        displayName = l.name
      }

      let operator = ''
      if (l.product && l.product.operatorName) {
        operator = l.product.operatorName
      }

      let trainNumber = ''
      if (l.product && l.product.number) {
        trainNumber = String(l.product.number)
      }

      let direction = ''
      if (l.direction) {
        direction = l.direction
      }

      let origin = ''
      if (o.name) {
        origin = o.name
      }
      let originTrack = ''
      if (o.actualTrack) {
        originTrack = o.actualTrack
      } else if (o.plannedTrack) {
        originTrack = o.plannedTrack
      }

      let destination = ''
      if (d.name) {
        destination = d.name
      }
      let destinationTrack = ''
      if (d.actualTrack) {
        destinationTrack = d.actualTrack
      } else if (d.plannedTrack) {
        destinationTrack = d.plannedTrack
      }

      let departure = ''
      if (o.plannedDateTime) {
        departure = o.plannedDateTime
      } else if (o.actualDateTime) {
        departure = o.actualDateTime
      }
      let arrival = ''
      if (d.plannedDateTime) {
        arrival = d.plannedDateTime
      } else if (d.actualDateTime) {
        arrival = d.actualDateTime
      }

      let durationMin = 0
      if (typeof l.actualDurationInMinutes === 'number') {
        durationMin = l.actualDurationInMinutes
      } else if (typeof l.plannedDurationInMinutes === 'number') {
        durationMin = l.plannedDurationInMinutes
      }

      let crowd = 'UNKNOWN'
      if (l.crowdForecast) {
        crowd = l.crowdForecast
      }

      let stopCount = 2
      if (Array.isArray(l.stops)) {
        stopCount = l.stops.length
      }
      let intermediateStops = stopCount - 2
      if (intermediateStops < 0) {
        intermediateStops = 0
      }

      let exitSide = ''
      if (d.exitSide) {
        exitSide = d.exitSide
      }

      let walkToNextMin: number | null = null
      if (typeof l.transferTimeToNextLeg === 'number') {
        walkToNextMin = l.transferTimeToNextLeg
      }

      let legCancelled = false
      if (l.cancelled) {
        legCancelled = true
      }

      legs.push({
        service: service,
        mode: legMode(l),
        category: category,
        displayName: displayName,
        operator: operator,
        trainNumber: trainNumber,
        direction: direction,
        origin: origin,
        originTrack: originTrack,
        destination: destination,
        destinationTrack: destinationTrack,
        departure: departure,
        departureDelayMin: delay(o.plannedDateTime, o.actualDateTime),
        arrival: arrival,
        arrivalDelayMin: delay(d.plannedDateTime, d.actualDateTime),
        durationMin: durationMin,
        crowd: crowd,
        intermediateStops: intermediateStops,
        stops: parseStops(l.stops),
        exitSide: exitSide,
        walkToNextMin: walkToNextMin,
        cancelled: legCancelled,
      })
    }

    const first = legs[0]
    const last = legs[legs.length - 1]

    let status = 'NORMAL'
    if (t.status) {
      status = t.status
    }

    let cancelled = false
    if (status === 'CANCELLED') {
      cancelled = true
    } else {
      for (const leg of legs) {
        if (leg.cancelled) {
          cancelled = true
          break
        }
      }
    }

    let cancellationReason = ''
    if (cancelled) {
      const messages: any[] = []
      if (t.messages) {
        for (const m of t.messages) {
          messages.push(m)
        }
      }
      for (const l of rawLegs) {
        if (l.messages) {
          for (const m of l.messages) {
            messages.push(m)
          }
        }
      }
      for (const m of messages) {
        const text = messageText(m)
        if (text.trim()) {
          cancellationReason = text
          break
        }
      }
    }

    let tripDuration = 0
    if (typeof t.actualDurationInMinutes === 'number') {
      tripDuration = t.actualDurationInMinutes
    } else if (typeof t.plannedDurationInMinutes === 'number') {
      tripDuration = t.plannedDurationInMinutes
    }

    let transfers = 0
    if (typeof t.transfers === 'number') {
      transfers = t.transfers
    }

    let tripCrowd = 'UNKNOWN'
    if (t.crowdForecast) {
      tripCrowd = t.crowdForecast
    }

    let tripDeparture = ''
    if (first) {
      tripDeparture = first.departure
    }
    let tripArrival = ''
    if (last) {
      tripArrival = last.arrival
    }

    trips.push({
      departure: tripDeparture,
      arrival: tripArrival,
      durationMin: tripDuration,
      transfers: transfers,
      status: status,
      cancelled: cancelled,
      cancellationReason: cancellationReason,
      crowd: tripCrowd,
      legs: legs,
    })
  }

  return trips
}

export async function fetchJourney(
  train: string,
  opts: { dateTime?: string; lang?: string } = {},
): Promise<LegStop[]> {
  let lang = 'en'
  if (opts.lang) {
    lang = opts.lang
  }
  let url =
    BASE + '/v2/journey?lang=' + encodeURIComponent(lang) + '&train=' + encodeURIComponent(train)
  if (opts.dateTime) {
    url += '&dateTime=' + encodeURIComponent(opts.dateTime)
  }
  const data = await getJSON(url)

  let rawStops: any[] = []
  if (data && data.payload && data.payload.stops) {
    rawStops = data.payload.stops
  }
  return parseJourneyStops(rawStops)
}

export interface StationInfo {
  code: string
  name: string
  country: string
  synonyms: string[]
}

export async function fetchStations(): Promise<StationInfo[]> {
  const data = await getJSON(BASE + '/v2/stations')

  let payload: any[] = []
  if (data && data.payload) {
    payload = data.payload
  }

  const stations: StationInfo[] = []
  for (const s of payload) {
    let name = s.code
    if (s.namen && s.namen.lang) {
      name = s.namen.lang
    } else if (s.namen && s.namen.middel) {
      name = s.namen.middel
    }
    let country = ''
    if (s.land) {
      country = s.land
    }
    let synonyms: string[] = []
    if (Array.isArray(s.synoniemen)) {
      synonyms = s.synoniemen
    }
    stations.push({ code: s.code, name: name, country: country, synonyms: synonyms })
  }
  return stations
}

export async function fetchBoard(stationCode: string): Promise<Board> {
  const depPromise = getJSON(
    BASE + '/v2/departures?station=' + encodeURIComponent(stationCode) + '&maxJourneys=8',
  )
  const disPromise = getJSON(
    BASE + '/v3/disruptions/station/' + encodeURIComponent(stationCode),
  ).catch(function () {
    return []
  })

  const both = await Promise.all([depPromise, disPromise])
  const dep = both[0]
  const dis = both[1]

  let rawDeps: any[] = []
  if (dep && dep.payload && dep.payload.departures) {
    rawDeps = dep.payload.departures
  }

  const departures: Departure[] = []
  for (const d of rawDeps) {
    const planned = d.plannedDateTime
    let actual = d.plannedDateTime
    if (d.actualDateTime) {
      actual = d.actualDateTime
    }
    const delayMin = delay(planned, actual)
    let track = '?'
    if (d.actualTrack) {
      track = d.actualTrack
    } else if (d.plannedTrack) {
      track = d.plannedTrack
    }
    let time = actual
    if (planned) {
      time = planned
    }
    let trackChanged = false
    if (d.actualTrack && d.plannedTrack && d.actualTrack !== d.plannedTrack) {
      trackChanged = true
    }
    let cancelled = false
    if (d.cancelled === true || d.departureStatus === 'CANCELLED') {
      cancelled = true
    }
    departures.push({
      destination: d.direction,
      time: time,
      delayMin: delayMin,
      track: track,
      trackChanged: trackChanged,
      cancelled: cancelled,
    })
  }

  let list: any[] = []
  if (Array.isArray(dis)) {
    list = dis
  } else if (dis && dis.payload) {
    list = dis.payload
  }

  const disruptions: Disruption[] = []
  for (const x of list) {
    if (x.isActive === false) {
      continue
    }
    let type = 'DISRUPTION'
    if (x.type) {
      type = x.type
    }
    let title = 'Storing'
    if (x.title) {
      title = x.title
    } else if (x.topic) {
      title = x.topic
    }
    disruptions.push({ type: type, title: title })
  }

  return { departures: departures, disruptions: disruptions }
}
