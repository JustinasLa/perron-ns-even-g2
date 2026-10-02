import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  StartUpPageCreateResult,
} from '@evenrealities/even_hub_sdk'
import { fetchStations, fetchTrips, fetchJourney } from './ns'
import type { StationInfo, Trip, TripLeg, LegStop, TravelMode, TripOptions } from './ns'
import { t as tr, getLang, setLang, dateLocale, LANGS } from './i18n'
import type { Lang } from './i18n'
import './style.css'

import iconCross from './icons/Edit & Settings Icons/Cross.svg?raw'
import iconSwitch from './icons/Edit & Settings Icons/Switch.svg?raw'
import iconAccount from './icons/Feature & Function Icons/Account.svg?raw'
import iconLanguages from './icons/Feature & Function Icons/Languages.svg?raw'
import iconTimeCounting from './icons/Feature & Function Icons/Time Counting.svg?raw'
import iconBack from './icons/Guide System/Back.svg?raw'
import iconChevronBack from './icons/Guide System/Chevron - Back.svg?raw'
import iconChevronDrillIn from './icons/Guide System/Chevron - Drill-in.svg?raw'
import iconGo from './icons/Guide System/Go.svg?raw'
import iconBus from './icons/Navigate Feature Icon/Bus.svg?raw'
import iconEndLocation from './icons/Navigate Feature Icon/End Location.svg?raw'
import iconHomeAddress from './icons/Navigate Feature Icon/Home Address.svg?raw'
import iconLocation from './icons/Navigate Feature Icon/Location.svg?raw'
import iconOfficeAddress from './icons/Navigate Feature Icon/Office Address.svg?raw'
import iconTrain from './icons/Navigate Feature Icon/Train.svg?raw'
import iconWalk from './icons/Navigate Feature Icon/Walk.svg?raw'
import iconFav from './icons/Status Icons/Fav.svg?raw'
import iconMore from './icons/Status Icons/More.svg?raw'
import iconUnfav from './icons/Status Icons/Unfav.svg?raw'

const ICON_RAW: Record<string, string> = {
  './icons/Edit & Settings Icons/Cross.svg': iconCross,
  './icons/Edit & Settings Icons/Switch.svg': iconSwitch,
  './icons/Feature & Function Icons/Account.svg': iconAccount,
  './icons/Feature & Function Icons/Languages.svg': iconLanguages,
  './icons/Feature & Function Icons/Time Counting.svg': iconTimeCounting,
  './icons/Guide System/Back.svg': iconBack,
  './icons/Guide System/Chevron - Back.svg': iconChevronBack,
  './icons/Guide System/Chevron - Drill-in.svg': iconChevronDrillIn,
  './icons/Guide System/Go.svg': iconGo,
  './icons/Navigate Feature Icon/Bus.svg': iconBus,
  './icons/Navigate Feature Icon/End Location.svg': iconEndLocation,
  './icons/Navigate Feature Icon/Home Address.svg': iconHomeAddress,
  './icons/Navigate Feature Icon/Location.svg': iconLocation,
  './icons/Navigate Feature Icon/Office Address.svg': iconOfficeAddress,
  './icons/Navigate Feature Icon/Train.svg': iconTrain,
  './icons/Navigate Feature Icon/Walk.svg': iconWalk,
  './icons/Status Icons/Fav.svg': iconFav,
  './icons/Status Icons/More.svg': iconMore,
  './icons/Status Icons/Unfav.svg': iconUnfav,
}

const BODY = { id: 1, name: 'body', x: 0, y: 0, w: 576, h: 288, pad: 4, border: 0 }

const CLOCK_MS = 10000
let clockTimer: ReturnType<typeof setInterval> | undefined

const TRIPS_REFRESH_MS = 60000
let tripsTimer: ReturnType<typeof setInterval> | undefined

interface SavedRoute {
  fromCode: string
  fromName: string
  toCode: string
  toName: string
}
const ROUTES_KEY = 'perron-ns.routes.v1'
let savedRoutes: SavedRoute[] = []

function isStoredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function loadRoutes(): Promise<SavedRoute[]> {
  try {
    const stored = await bridge.getLocalStorage(ROUTES_KEY)
    let text = '[]'
    if (stored) {
      text = stored
    }
    const raw: unknown = JSON.parse(text)
    if (!Array.isArray(raw)) {
      return []
    }
    const result: SavedRoute[] = []
    const seen = new Set<string>()
    for (const r of raw) {
      if (!r || typeof r !== 'object' || !isStoredText(r.fromCode) || !isStoredText(r.fromName) || !isStoredText(r.toCode) || !isStoredText(r.toName)) {
        continue
      }
      const key = JSON.stringify([r.fromCode, r.toCode])
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      result.push({ fromCode: r.fromCode, fromName: r.fromName, toCode: r.toCode, toName: r.toName })
    }
    return result.slice(0, 8)
  } catch {
    return []
  }
}

async function persistRoutes() {
  try {
    await bridge.setLocalStorage(ROUTES_KEY, JSON.stringify(savedRoutes))
  } catch (err) {
    console.error('persistRoutes failed:', err)
  }
}

function addRoute(r: SavedRoute) {
  const rest: SavedRoute[] = []
  for (const s of savedRoutes) {
    if (s.fromCode === r.fromCode && s.toCode === r.toCode) {
      continue
    }
    rest.push(s)
  }
  const combined: SavedRoute[] = [r]
  for (const s of rest) {
    combined.push(s)
  }
  savedRoutes = combined.slice(0, 8)
  persistRoutes()
  onRoutesChanged()
}

function removeRoute(fromCode: string, toCode: string) {
  const next: SavedRoute[] = []
  for (const r of savedRoutes) {
    if (r.fromCode === fromCode && r.toCode === toCode) {
      continue
    }
    next.push(r)
  }
  savedRoutes = next
  persistRoutes()
  onRoutesChanged()
}

function onRoutesChanged() {
  renderSavedRoutes()
  if (view === 'home') {
    renderLens().catch(function (err) {
      console.error(err)
    })
  }
}

type FavIcon = 'home' | 'work' | 'default'
interface Favorite {
  code: string
  name: string
  label: string
  icon: FavIcon
}
const FAVES_KEY = 'perron-ns.favorites.v1'
let favorites: Favorite[] = []

async function loadFavorites(): Promise<Favorite[]> {
  try {
    const stored = await bridge.getLocalStorage(FAVES_KEY)
    let text = '[]'
    if (stored) {
      text = stored
    }
    const raw: unknown = JSON.parse(text)
    if (!Array.isArray(raw)) {
      return []
    }
    const result: Favorite[] = []
    const seen = new Set<string>()
    for (const f of raw) {
      if (!f || typeof f !== 'object' || !isStoredText(f.code) || !isStoredText(f.name)) {
        continue
      }
      if (seen.has(f.code)) {
        continue
      }
      seen.add(f.code)
      let label = f.name
      if (typeof f.label === 'string') {
        label = f.label
      }
      let icon: FavIcon = 'default'
      if (f.icon === 'home' || f.icon === 'work') {
        icon = f.icon
      }
      result.push({ code: f.code, name: f.name, label: label, icon: icon })
    }
    return result
  } catch {
    return []
  }
}

async function persistFavorites() {
  try {
    await bridge.setLocalStorage(FAVES_KEY, JSON.stringify(favorites))
  } catch (err) {
    console.error('persistFavorites failed:', err)
  }
}

function isFavorite(code: string): boolean {
  for (const f of favorites) {
    if (f.code === code) {
      return true
    }
  }
  return false
}

function addFavorite(f: { code: string; name: string }) {
  if (!isFavorite(f.code)) {
    favorites.push({ code: f.code, name: f.name, label: f.name, icon: 'default' })
    persistFavorites()
    renderFavorites()
  }
}

function removeFavorite(code: string) {
  const next: Favorite[] = []
  for (const f of favorites) {
    if (f.code !== code) {
      next.push(f)
    }
  }
  favorites = next
  persistFavorites()
  renderFavorites()
}

type TimeMode = 'departure' | 'arrival'
let planTimeMode: TimeMode = 'departure'
let planDateTime: Date | null = null

function tripOpts(): TripOptions {
  const opts: TripOptions = { lang: getLang() }
  if (planDateTime || planTimeMode === 'arrival') {
    const dateTime = planDateTime || new Date()
    opts.dateTime = dateTime.toISOString()
    opts.searchForArrival = planTimeMode === 'arrival'
  }
  return opts
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function clockNow(): string {
  return new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

const bridge = await waitForEvenAppBridge()

const LANG_KEY = 'perron-ns.lang.v1'

async function loadLang(): Promise<void> {
  try {
    const stored = await bridge.getLocalStorage(LANG_KEY)
    if (stored === 'nl' || stored === 'en') {
      setLang(stored)
    }
  } catch (err) {
    console.error('loadLang failed:', err)
  }
}

async function persistLang() {
  try {
    await bridge.setLocalStorage(LANG_KEY, getLang())
  } catch (err) {
    console.error('persistLang failed:', err)
  }
}

await loadLang()
savedRoutes = await loadRoutes()
favorites = await loadFavorites()

const body = new TextContainerProperty({
  xPosition: BODY.x, yPosition: BODY.y, width: BODY.w, height: BODY.h,
  borderWidth: BODY.border, borderColor: 5, paddingLength: BODY.pad,
  containerID: BODY.id, containerName: BODY.name,
  content: clockNow(), isEventCapture: 1,
})

let cleanedUp = false
let pageCreated = false
let rendering: Promise<void> = Promise.resolve()
async function draw(bodyText: string) {
  if (cleanedUp) {
    return
  }
  const update = rendering.then(async function () {
    if (cleanedUp) {
      return
    }
    if (!pageCreated) {
      const created = await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [body] }),
      )
      if (created !== StartUpPageCreateResult.success) {
        console.error('createStartUpPageContainer failed:', created)
        return
      }
      pageCreated = true
    }
    if (cleanedUp) {
      return
    }
    const updated = await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: BODY.id, containerName: BODY.name, content: bodyText }),
    )
    if (!updated) {
      throw new Error('textContainerUpgrade failed')
    }
  })
  rendering = update.catch(function () {})
  await update
}

const MAX_JOURNEYS = 3
let journeyIdx = 0

function visibleJourneyCount(): number {
  if (savedRoutes.length < MAX_JOURNEYS) {
    return savedRoutes.length
  }
  return MAX_JOURNEYS
}

let view: 'home' | 'list' | 'detail' = 'home'
let detailRoute: SavedRoute | null = null
let detailTrips: Trip[] = []
let tripIdx = 0
let detailStatus: 'loading' | 'ready' | 'error' = 'loading'
let detailError = ''

function lensContent(): string {
  const count = visibleJourneyCount()
  if (journeyIdx >= count) {
    journeyIdx = Math.max(0, count - 1)
  }
  const lines: string[] = [
    tr('lensPrompt'),
  ]
  for (let i = 0; i < savedRoutes.length && i < MAX_JOURNEYS; i++) {
    const r = savedRoutes[i]
    let marker = ' '
    if (i === journeyIdx) {
      marker = '>'
    }
    lines.push(marker + ' ' + (i + 1) + '. ' + r.fromName + ' ' + tr('connectorTo') + ' ' + r.toName)
  }
  return lines.join('\n')
}

async function renderLens() {
  let content = ''
  if (view === 'detail') {
    content = detailContent()
  } else if (view === 'list') {
    content = listContent()
  } else {
    content = lensContent()
  }
  await draw(clockNow() + '\n' + content)
}

function cycleJourney(delta: number) {
  const count = visibleJourneyCount()
  if (count === 0) {
    return
  }
  journeyIdx = (journeyIdx + delta + count) % count
  renderLens().catch(function (err) {
    console.error(err)
  })
}

const MAX_TRIP_OPTIONS = 5

function delayTag(min: number): string {
  if (min > 0) {
    return ' +' + min
  }
  return ''
}

function visibleTripCount(): number {
  if (detailTrips.length < MAX_TRIP_OPTIONS) {
    return detailTrips.length
  }
  return MAX_TRIP_OPTIONS
}

function listContent(): string {
  const route = detailRoute
  if (!route) {
    return lensContent()
  }
  const head = route.fromName + ' > ' + route.toName
  if (detailStatus === 'loading') {
    return head + '\n\n' + tr('loadingTimes')
  }
  if (detailStatus === 'error') {
    return head + '\n\n! ' + detailError
  }

  const count = visibleTripCount()
  if (tripIdx >= count) {
    tripIdx = Math.max(0, count - 1)
  }
  const lines: string[] = [head, '']
  for (let i = 0; i < detailTrips.length && i < MAX_TRIP_OPTIONS; i++) {
    const t = detailTrips[i]
    let firstDelay = 0
    if (t.legs[0]) {
      firstDelay = t.legs[0].departureDelayMin
    }
    let lastDelay = 0
    if (t.legs[t.legs.length - 1]) {
      lastDelay = t.legs[t.legs.length - 1].arrivalDelayMin
    }
    const dep = hhmm(t.departure) + delayTag(firstDelay)
    const arr = hhmm(t.arrival) + delayTag(lastDelay)
    let marker = ' '
    if (i === tripIdx) {
      marker = '>'
    }
    if (t.cancelled) {
      lines.push(marker + ' ' + dep + ' - ' + arr + ' | ' + tr('cancelledCaps'))
    } else {
      const tripTime = tr('tripTimeLabel') + ' ' + fmtDuration(t.durationMin) + 'h'
      let transferWord = tr('transfers')
      if (t.transfers === 1) {
        transferWord = tr('transfer')
      }
      const transfers = t.transfers + 'x ' + transferWord
      lines.push(marker + ' ' + dep + ' - ' + arr + ' | ' + tripTime + ' | ' + transfers)
    }
  }
  return lines.join('\n')
}

function detailContent(): string {
  const route = detailRoute
  if (!route) {
    return lensContent()
  }
  const count = visibleTripCount()
  if (count === 0) {
    return route.fromName + ' > ' + route.toName + '\n\n' + tr('noDepartures')
  }
  if (tripIdx >= count) {
    tripIdx = count - 1
  }

  const trip = detailTrips[tripIdx]
  let lastArrDelay = 0
  if (trip.legs[trip.legs.length - 1]) {
    lastArrDelay = trip.legs[trip.legs.length - 1].arrivalDelayMin
  }
  const eta = hhmm(trip.arrival) + delayTag(lastArrDelay)
  const lines: string[] = [route.fromName + ' > ' + route.toName + ' | ' + tr('etaLabel') + ' ' + eta, '']
  if (trip.cancelled) {
    if (trip.cancellationReason) {
      lines.push(tr('cancelledCaps') + ' — ' + trip.cancellationReason)
    } else {
      lines.push(tr('cancelledCaps'))
    }
    lines.push('')
  }
  for (let i = 0; i < trip.legs.length; i++) {
    const leg = trip.legs[i]
    let modeTag = ''
    if (leg.mode !== 'TRAIN' && modeLabel(leg.mode)) {
      modeTag = modeLabel(leg.mode) + ' · '
    }
    let originPlatform = ''
    if (leg.originTrack) {
      originPlatform = ' | ' + tr('platformLabel') + ' ' + leg.originTrack
    }
    let destPlatform = ''
    if (leg.destinationTrack) {
      destPlatform = ' | ' + tr('platformLabel') + ' ' + leg.destinationTrack
    }
    lines.push(hhmm(leg.departure) + delayTag(leg.departureDelayMin) + ' ' + leg.origin + originPlatform)
    lines.push('    ' + modeTag + tr('tripLegLabel') + ' ' + legDurationText(leg.durationMin))
    lines.push(hhmm(leg.arrival) + delayTag(leg.arrivalDelayMin) + ' ' + leg.destination + destPlatform)
    if (i < trip.legs.length - 1) {
      const next = trip.legs[i + 1]
      let gap = Math.round((new Date(next.departure).getTime() - new Date(leg.arrival).getTime()) / 60000)
      if (gap < 0) {
        gap = 0
      }
      lines.push('')
      lines.push(tr('changeLabel') + ' (' + gap + ' ' + tr('minShort') + ')')
      lines.push('')
    }
  }
  return lines.join('\n')
}

async function openTripList() {
  const count = visibleJourneyCount()
  if (count === 0) {
    return
  }
  let index = journeyIdx
  if (index > count - 1) {
    index = count - 1
  }
  const route = savedRoutes[index]
  view = 'list'
  detailRoute = route
  detailStatus = 'loading'
  detailTrips = []
  tripIdx = 0
  await renderLens()
  try {
    const trips = await fetchTrips(route.fromCode, route.toCode, tripOpts())
    detailTrips = trips
    if (trips.length) {
      detailStatus = 'ready'
    } else {
      detailStatus = 'error'
      detailError = tr('noDepartures')
    }
  } catch (e) {
    detailStatus = 'error'
    if (e instanceof Error) {
      detailError = e.message
    } else {
      detailError = String(e)
    }
  }
  if (detailRoute === route) {
    await renderLens()
  }
}

async function refreshOpenTrips() {
  const route = detailRoute
  if (!route || (view !== 'list' && view !== 'detail')) {
    return
  }
  let trips: Trip[]
  try {
    trips = await fetchTrips(route.fromCode, route.toCode, tripOpts())
  } catch {
    return
  }
  if (detailRoute !== route || (view !== 'list' && view !== 'detail')) {
    return
  }
  if (!trips.length) {
    return
  }
  let selectedDep = ''
  if (detailTrips[tripIdx]) {
    selectedDep = detailTrips[tripIdx].departure
  }
  detailTrips = trips
  detailStatus = 'ready'
  let cap = MAX_TRIP_OPTIONS
  if (trips.length < cap) {
    cap = trips.length
  }
  let newIdx = -1
  if (selectedDep) {
    for (let i = 0; i < trips.length; i++) {
      if (trips[i].departure === selectedDep) {
        newIdx = i
        break
      }
    }
  }
  if (newIdx >= 0 && newIdx < cap) {
    tripIdx = newIdx
  } else if (tripIdx > cap - 1) {
    tripIdx = cap - 1
  }
  await renderLens()
}

function openTripDetail() {
  if (detailStatus !== 'ready' || visibleTripCount() === 0) {
    return
  }
  view = 'detail'
  renderLens().catch(function (err) {
    console.error(err)
  })
}

function cycleTrip(delta: number) {
  if (detailStatus !== 'ready') {
    return
  }
  const count = visibleTripCount()
  if (count === 0) {
    return
  }
  tripIdx = (tripIdx + delta + count) % count
  renderLens().catch(function (err) {
    console.error(err)
  })
}

function goBack(): boolean {
  if (view === 'detail') {
    view = 'list'
  } else if (view === 'list') {
    view = 'home'
    detailRoute = null
    detailTrips = []
  } else {
    return false
  }
  renderLens().catch(function (err) {
    console.error(err)
  })
  return true
}

function cleanup() {
  if (cleanedUp) {
    return
  }
  cleanedUp = true
  if (clockTimer) {
    clearInterval(clockTimer)
  }
  if (tripsTimer) {
    clearInterval(tripsTimer)
  }
  unsubscribe()
}

const unsubscribe = bridge.onEvenHubEvent(function (event) {
  let sysType: number | null = null
  if (event.sysEvent) {
    if (event.sysEvent.eventType === undefined || event.sysEvent.eventType === null) {
      sysType = OsEventTypeList.CLICK_EVENT
    } else {
      sysType = event.sysEvent.eventType
    }
  }
  let textType: number | null = null
  if (event.textEvent && event.textEvent.eventType !== undefined && event.textEvent.eventType !== null) {
    textType = event.textEvent.eventType
  }

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (goBack()) {
      return
    }
    bridge.shutDownPageContainer(1).catch(function (err) {
      console.error(err)
    })
    return
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    if (view === 'home') {
      cycleJourney(-1)
    } else if (view === 'list') {
      cycleTrip(-1)
    }
    return
  }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    if (view === 'home') {
      cycleJourney(1)
    } else if (view === 'list') {
      cycleTrip(1)
    }
    return
  }
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    if (view === 'home') {
      openTripList().catch(function (err) {
        console.error(err)
      })
    } else if (view === 'list') {
      openTripDetail()
    }
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
  }
})

window.addEventListener('beforeunload', cleanup)

function icon(name: string, opts: { size?: number; cls?: string; recolor?: boolean } = {}): string {
  let size = 18
  if (opts.size !== undefined) {
    size = opts.size
  }
  let cls = ''
  if (opts.cls) {
    cls = opts.cls
  }
  let recolor = true
  if (opts.recolor === false) {
    recolor = false
  }
  let raw = ICON_RAW['./icons/' + name + '.svg']
  if (!raw) {
    console.warn('missing icon:', name)
    return ''
  }
  raw = raw.replace(/<svg width="\d+" height="\d+"/, '<svg width="' + size + '" height="' + size + '"')
  if (recolor) {
    raw = raw.replace(/#232323/g, 'currentColor')
  }
  let classAttr = 'icon'
  if (cls) {
    classAttr = 'icon ' + cls
  }
  return '<span aria-hidden="true" class="' + classAttr + '">' + raw + '</span>'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ARROW_ICON = icon('Guide System/Go', { size: 20 })
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main class="planner">

    <div class="lang-row">
      <div class="lang-picker">
        <button id="lang-toggle" type="button" class="lang-btn" aria-label="${tr('ariaLang')}" aria-haspopup="listbox" aria-expanded="false">${icon('Feature & Function Icons/Languages', { size: 20 })}</button>
        <ul id="lang-menu" role="listbox" hidden class="autocomplete lang-menu"></ul>
      </div>
    </div>

    <section class="route-card">
      <div class="route-line"></div>

      <label class="route-field">
        <span class="route-marker">${icon('Navigate Feature Icon/Location', { size: 20 })}</span>
        <input id="from" type="text" placeholder="${tr('from')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" class="route-input" />
        <ul id="from-list" role="listbox" hidden class="autocomplete autocomplete--route"></ul>
      </label>

      <div class="route-divider"></div>

      <label class="route-field">
        <span class="route-marker">${icon('Navigate Feature Icon/End Location', { size: 20 })}</span>
        <input id="to" type="text" placeholder="${tr('to')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" class="route-input" />
        <ul id="to-list" role="listbox" hidden class="autocomplete autocomplete--route"></ul>
      </label>

      <button id="swap" type="button" aria-label="${tr('ariaSwap')}" class="swap-btn">${icon('Edit & Settings Icons/Switch', { size: 22 })}</button>
    </section>

    <div class="action-row">
      <button id="dep-box" type="button" class="dep-box" aria-haspopup="dialog">
        <span class="dep-box-text"><span id="dep-label">${tr('departureLabel')}</span><span id="dep-value" class="muted"> ${tr('now')}</span></span>
        <span class="dep-box-icon muted">${icon('Feature & Function Icons/Time Counting', { size: 18 })}</span>
      </button>
    </div>

    <div class="action-row">
      <button id="plan" type="button" class="plan-btn">${ARROW_ICON}<span id="plan-text">${tr('plan')}</span></button>
      <button id="clear-search" type="button" aria-label="${tr('ariaClear')}" class="clear-btn">${icon('Edit & Settings Icons/Cross', { size: 18 })}</button>
    </div>

    <div id="home-sections">
      <section class="panel panel--fav">
        <div class="panel-title" id="fav-title">${tr('favorites')}</div>
        <div id="fav-list"></div>
        <div class="fav-add-row">
          <span class="fav-search">
            <input id="fav-input" type="text" placeholder="${tr('searchStation')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" class="fav-search-input" />
            <ul id="fav-list-dropdown" role="listbox" hidden class="autocomplete"></ul>
          </span>
          <button id="fav-add" type="button" class="add-btn">${tr('add')}</button>
        </div>
      </section>

      <section class="panel panel--again">
        <div class="panel-title" id="again-title">${tr('planAgain')}</div>
        <div id="saved"></div>
      </section>
    </div>

    <div id="results" class="results"></div>
  </main>
`

const fromEl = document.getElementById('from') as HTMLInputElement | null
const toEl = document.getElementById('to') as HTMLInputElement | null
const swapBtn = document.getElementById('swap')
if (swapBtn) {
  swapBtn.addEventListener('click', function () {
    if (!fromEl || !toEl) {
      return
    }
    const tmpVal = fromEl.value
    fromEl.value = toEl.value
    toEl.value = tmpVal
    const tmpCode = fromEl.dataset.code
    if (toEl.dataset.code) {
      fromEl.dataset.code = toEl.dataset.code
    } else {
      delete fromEl.dataset.code
    }
    if (tmpCode) {
      toEl.dataset.code = tmpCode
    } else {
      delete toEl.dataset.code
    }
  })
}

let stationList: StationInfo[] = []
fetchStations()
  .then(function (list) {
    stationList = list
  })
  .catch(function (err) {
    console.error('station list load failed:', err)
  })

function rankStations(q: string): StationInfo[] {
  const ql = q.toLowerCase()
  const scored: { s: StationInfo; score: number }[] = []
  for (const s of stationList) {
    const name = s.name.toLowerCase()
    let score = -1
    if (name.startsWith(ql) || s.code.toLowerCase() === ql) {
      score = 0
    } else if (name.includes(ql)) {
      score = 1
    } else {
      let synMatch = false
      for (const syn of s.synonyms) {
        if (syn.toLowerCase().includes(ql)) {
          synMatch = true
          break
        }
      }
      if (synMatch) {
        score = 2
      }
    }
    if (score < 0) {
      continue
    }
    if (s.country !== 'NL') {
      score += 3
    }
    scored.push({ s: s, score: score })
  }
  scored.sort(function (a, b) {
    if (a.score !== b.score) {
      return a.score - b.score
    }
    return a.s.name.localeCompare(b.s.name)
  })
  const result: StationInfo[] = []
  for (let i = 0; i < scored.length && i < 7; i++) {
    result.push(scored[i].s)
  }
  return result
}

function attachAutocomplete(input: HTMLInputElement, list: HTMLUListElement, saveable: boolean = false) {
  let items: StationInfo[] = []
  let active = -1

  function close() {
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    items = []
    active = -1
  }
  function setActive(i: number) {
    active = i
    const children = list.children
    for (let idx = 0; idx < children.length; idx++) {
      const li = children[idx] as HTMLElement
      if (idx === i) {
        li.classList.add('active')
      } else {
        li.classList.remove('active')
      }
    }
  }
  function choose(st: StationInfo) {
    input.value = st.name
    input.dataset.code = st.code
    close()
  }
  function toggleFavorite(st: StationInfo, starBtn: HTMLElement) {
    if (isFavorite(st.code)) {
      removeFavorite(st.code)
    } else {
      addFavorite({ code: st.code, name: st.name })
    }
    starBtn.innerHTML = starSvg(isFavorite(st.code))
  }
  function render(matches: StationInfo[]) {
    items = matches
    active = -1
    if (matches.length === 0) {
      close()
      return
    }
    list.innerHTML = ''
    for (let i = 0; i < matches.length; i++) {
      const st = matches[i]
      const index = i
      const li = document.createElement('li')
      li.setAttribute('role', 'option')
      li.className = 'option'
      const name = document.createElement('span')
      name.textContent = st.name
      name.className = 'option-name'
      li.appendChild(name)
      if (st.country && st.country !== 'NL') {
        const c = document.createElement('span')
        c.textContent = st.country
        c.className = 'option-country'
        li.appendChild(c)
      }
      if (saveable) {
        const star = document.createElement('button')
        star.type = 'button'
        star.setAttribute('aria-label', tr('ariaSaveFav'))
        star.className = 'option-star'
        star.innerHTML = starSvg(isFavorite(st.code))
        star.addEventListener('mousedown', function (e) {
          e.preventDefault()
          e.stopPropagation()
          toggleFavorite(st, star)
        })
        li.appendChild(star)
      }
      li.addEventListener('mousedown', function (e) {
        e.preventDefault()
        choose(st)
      })
      li.addEventListener('mouseenter', function () {
        setActive(index)
      })
      list.appendChild(li)
    }
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
  }

  input.addEventListener('input', function () {
    delete input.dataset.code
    const q = input.value.trim()
    if (q.length < 1) {
      close()
      return
    }
    render(rankStations(q))
  })
  input.addEventListener('keydown', function (e) {
    if (list.hidden || items.length === 0) {
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((active + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((active - 1 + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      let idx = active
      if (idx < 0) {
        idx = 0
      }
      choose(items[idx])
    } else if (e.key === 'Escape') {
      close()
    }
  })
  input.addEventListener('blur', function () {
    setTimeout(close, 120)
  })
}

const fromList = document.getElementById('from-list') as HTMLUListElement | null
const toList = document.getElementById('to-list') as HTMLUListElement | null
const favInput = document.getElementById('fav-input') as HTMLInputElement | null
const favListDd = document.getElementById('fav-list-dropdown') as HTMLUListElement | null
if (fromEl && fromList) {
  attachAutocomplete(fromEl, fromList, true)
}
if (toEl && toList) {
  attachAutocomplete(toEl, toList, true)
}
if (favInput && favListDd) {
  attachAutocomplete(favInput, favListDd)
}

function resolveCode(input: HTMLInputElement): string | null {
  if (input.dataset.code) {
    return input.dataset.code
  }
  if (!input.value.trim()) {
    return null
  }
  const ranked = rankStations(input.value.trim())
  if (ranked[0]) {
    return ranked[0].code
  }
  return null
}

function fmtTime(iso: string): string {
  if (iso) {
    return hhmm(iso)
  }
  return '--:--'
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  let mm = String(m)
  if (mm.length < 2) {
    mm = '0' + mm
  }
  return h + ':' + mm
}

const CLOCK_ICON = icon('Feature & Function Icons/Time Counting', { size: 16, cls: 'muted' })
const TRANSFER_ICON = icon('Edit & Settings Icons/Switch', { size: 16, cls: 'muted' })
const MENU_DOTS = icon('Status Icons/More', { size: 20, cls: 'muted' })

function modeIcon(mode: TravelMode, size: number): string {
  if (mode === 'BUS') {
    return icon('Navigate Feature Icon/Bus', { size: size })
  }
  if (mode === 'WALK') {
    return icon('Navigate Feature Icon/Walk', { size: size })
  }
  return icon('Navigate Feature Icon/Train', { size: size })
}

function modeLabel(mode: TravelMode): string {
  if (mode === 'BUS') {
    return tr('modeBus')
  }
  if (mode === 'TRAM') {
    return tr('modeTram')
  }
  if (mode === 'METRO') {
    return tr('modeMetro')
  }
  if (mode === 'FERRY') {
    return tr('modeFerry')
  }
  if (mode === 'WALK') {
    return tr('modeWalk')
  }
  return ''
}

function legBadgeLabel(leg: TripLeg): string {
  if (leg.category) {
    return leg.category
  }
  const label = modeLabel(leg.mode)
  if (label) {
    return label
  }
  return tr('modeTrain')
}

function iconSvg(kind: FavIcon, size: number): string {
  if (kind === 'home') {
    return icon('Navigate Feature Icon/Home Address', { size: size })
  }
  if (kind === 'work') {
    return icon('Navigate Feature Icon/Office Address', { size: size })
  }
  return icon('Navigate Feature Icon/Train', { size: size })
}

function serviceBadges(legs: TripLeg[]): string {
  let html = ''
  for (const l of legs) {
    if (l.mode === 'WALK') {
      continue
    }
    html += '<span class="badge">' + modeIcon(l.mode, 18) + escapeHtml(legBadgeLabel(l)) + '</span>'
  }
  return html
}

function crowdBadge(crowd: string): string {
  let n = 0
  let cls = ''
  let label = ''
  if (crowd === 'LOW') {
    n = 1
    cls = 'crowd--low'
    label = tr('crowdQuiet')
  } else if (crowd === 'MEDIUM') {
    n = 2
    cls = 'crowd--medium'
    label = tr('crowdBusy')
  } else if (crowd === 'HIGH') {
    n = 3
    cls = 'crowd--high'
    label = tr('crowdVeryBusy')
  } else {
    return ''
  }
  const person = icon('Feature & Function Icons/Account', { size: 16 })
  let people = ''
  for (let i = 0; i < n; i++) {
    people += person
  }
  return '<span title="' + label + '" aria-label="' + label + '" class="crowd ' + cls + '">' + people + '</span>'
}

const results = document.getElementById('results') as HTMLDivElement | null
function setResults(html: string) {
  if (results) {
    results.innerHTML = html
  }
}

function delayBadge(min: number): string {
  if (min > 0) {
    return '<span class="delay"> +' + min + '</span>'
  }
  return ''
}

function metaSpan(iconHtml: string, text: string): string {
  return '<span class="meta">' + iconHtml + text + '</span>'
}

function gapMinutes(a: string, b: string): number {
  let g = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  if (g < 0) {
    g = 0
  }
  return g
}

function renderTrips(trips: Trip[]) {
  if (!results) {
    return
  }
  results.innerHTML = ''
  if (trips.length === 0) {
    setResults('<p class="notice">' + tr('noJourneys') + '</p>')
    return
  }
  for (let idx = 0; idx < trips.length; idx++) {
    const trip = trips[idx]
    const thisIdx = idx
    const services = serviceBadges(trip.legs)

    const card = document.createElement('div')
    card.dataset.idx = String(idx)
    if (trip.cancelled) {
      card.className = 'trip-card cancelled'
    } else {
      card.className = 'trip-card'
    }

    let firstDelay = 0
    if (trip.legs[0]) {
      firstDelay = trip.legs[0].departureDelayMin
    }
    let lastDelay = 0
    if (trip.legs[trip.legs.length - 1]) {
      lastDelay = trip.legs[trip.legs.length - 1].arrivalDelayMin
    }
    let badgesHtml = ''
    if (services) {
      badgesHtml = '<div class="badges">' + services + '</div>'
    }
    let cancelledHtml = ''
    if (trip.cancelled) {
      let reason = ''
      if (trip.cancellationReason) {
        reason = ' - ' + escapeHtml(trip.cancellationReason)
      }
      cancelledHtml = '<div class="trip-cancelled">' + tr('cancelled') + reason + '</div>'
    }

    card.innerHTML = `
      <div class="trip-head">
        <span class="trip-time">
          ${fmtTime(trip.departure)}${delayBadge(firstDelay)}
          <span class="muted"> - </span>
          ${fmtTime(trip.arrival)}${delayBadge(lastDelay)}
        </span>
        <span class="trip-meta">
          ${metaSpan(CLOCK_ICON, fmtDuration(trip.durationMin))}
          ${metaSpan(TRANSFER_ICON, trip.transfers + 'x')}
          ${crowdBadge(trip.crowd)}
        </span>
      </div>
      ${badgesHtml}
      ${cancelledHtml}
    `
    card.addEventListener('click', function () {
      const cards = results.querySelectorAll<HTMLDivElement>('[data-idx]')
      cards.forEach(function (el) {
        el.classList.remove('selected')
      })
      card.classList.add('selected')
      showDetail(trip, thisIdx)
    })
    results.appendChild(card)
  }
}

const BACK_ICON = icon('Guide System/Back', { size: 24 })
const CHEVRON_ICON = icon('Guide System/Chevron - Drill-in', { size: 18, cls: 'muted' })
const WALK_ICON = icon('Navigate Feature Icon/Walk', { size: 20, cls: 'muted' })

function modeSquare(mode: TravelMode): string {
  return '<span class="train-square">' + modeIcon(mode, 24) + '</span>'
}

function legDurationText(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60)
    let mm = String(min % 60)
    if (mm.length < 2) {
      mm = '0' + mm
    }
    return h + ':' + mm + ' h'
  }
  return min + ' min'
}

function fmtDateHeader(iso: string): string {
  const d = new Date(iso)
  const dateStr = d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
  if (d.toDateString() === new Date().toDateString()) {
    return tr('today') + ', ' + dateStr
  }
  return dateStr
}

function crowdInline(crowd: string): string {
  let text = tr('crowdUnknown')
  let cls = 'ctext--unknown'
  if (crowd === 'LOW') {
    text = tr('crowdCalm')
    cls = 'ctext--low'
  } else if (crowd === 'MEDIUM') {
    text = tr('crowdBusyInline')
    cls = 'ctext--medium'
  } else if (crowd === 'HIGH') {
    text = tr('crowdCrowded')
    cls = 'ctext--high'
  }
  return '<span class="' + cls + '">' + text + '</span>'
}

function platformBadge(track: string): string {
  if (!track) {
    return ''
  }
  return '<span class="platform">' + escapeHtml(track) + '</span>'
}

const STATION_DOT = '<span class="station-dot"></span>'

function legCard(leg: TripLeg, idx: number): string {
  let stopWord = tr('stopsPlural')
  if (leg.intermediateStops === 1) {
    stopWord = tr('stopsSingular')
  }
  const stops = leg.intermediateStops + ' ' + stopWord
  let exitHtml = ''
  if (leg.exitSide) {
    exitHtml = '<span class="leg-exit">' + tr('exitSideLabel') + ' ' + escapeHtml(leg.exitSide.toLowerCase()) + '</span>'
  }
  let serviceOpen = '<div class="leg-service">'
  let chevron = ''
  if (leg.stops.length > 1) {
    serviceOpen =
      '<div class="leg-service leg-service--tap" data-leg="' + idx + '" role="button" tabindex="0">'
    chevron = CHEVRON_ICON
  }
  return `
    <div class="leg">
      <div class="leg-times">
        <span class="leg-time">${fmtTime(leg.departure)}</span>
        <span class="leg-train">
          ${modeSquare(leg.mode)}
          <span class="leg-dur">${legDurationText(leg.durationMin)}</span>
        </span>
        <span class="leg-time">${fmtTime(leg.arrival)}</span>
      </div>
      <div class="leg-rail">
        ${STATION_DOT}
        <span class="leg-rail-line"></span>
        ${STATION_DOT}
      </div>
      <div class="leg-body">
        <div class="leg-stop">
          <span class="leg-station">${escapeHtml(leg.origin)}</span>
          ${platformBadge(leg.originTrack)}
        </div>
        ${serviceOpen}
          <div class="leg-service-text">
            <div class="leg-service-name">${escapeHtml(leg.displayName)}</div>
            <div class="leg-service-dir">${tr('connectorTo')} ${escapeHtml(leg.direction)}</div>
            <div class="leg-service-meta">${crowdInline(leg.crowd)} · ${stops}</div>
          </div>
          ${chevron}
        </div>
        <div class="leg-stop">
          <span>
            <span class="leg-station">${escapeHtml(leg.destination)}</span>
            ${exitHtml}
          </span>
          ${platformBadge(leg.destinationTrack)}
        </div>
      </div>
    </div>`
}

function transferBlock(prev: TripLeg, next: TripLeg): string {
  const total = gapMinutes(prev.arrival, next.departure)
  const walk = prev.walkToNextMin
  let wait: number | null = null
  if (walk !== null) {
    wait = total - walk
    if (wait < 0) {
      wait = 0
    }
  }
  let walkLabel = total
  if (walk !== null) {
    walkLabel = walk
  }
  let walkText = tr('walkToTransfer')
  if (next.originTrack) {
    walkText = tr('walkToPlatform') + ' ' + next.originTrack
  }
  let checkInOut = ''
  if (prev.operator && next.operator && prev.operator !== next.operator) {
    checkInOut = tr('checkOutIn') + ' ' + prev.operator.split(' ')[0] + ' - ' + next.operator.split(' ')[0]
  }

  function row(left: string, text: string): string {
    return `
    <div class="xfer-row">
      <span class="xfer-left">${left}</span>
      <span class="xfer-text">${escapeHtml(text)}</span>
    </div>`
  }

  let rows = row(walkLabel + ' ' + tr('minShort'), walkText)
  if (checkInOut) {
    rows += row(WALK_ICON, checkInOut)
  }
  if (wait !== null && wait > 0) {
    rows += row(wait + ' ' + tr('minShort'), tr('wait'))
  }

  return `
    <div class="xfer">
      <div class="xfer-line"></div>
      ${rows}
    </div>`
}

const detailView = document.createElement('div')
detailView.id = 'detail'
detailView.hidden = true
detailView.className = 'overlay'
document.body.appendChild(detailView)

const stopsView = document.createElement('div')
stopsView.id = 'stops'
stopsView.hidden = true
stopsView.className = 'overlay overlay--top'
document.body.appendChild(stopsView)

function starSvg(filled: boolean, size: number = 20): string {
  if (filled) {
    return icon('Status Icons/Fav', { size: size, recolor: false })
  }
  return icon('Status Icons/Unfav', { size: size, cls: 'muted' })
}

function nameForCode(code: string): string {
  for (const s of stationList) {
    if (s.code === code) {
      return s.name
    }
  }
  return code
}

function buildSummary(trip: Trip): string {
  let badges = ''
  for (let i = 0; i < trip.legs.length; i++) {
    const l = trip.legs[i]
    if (l.mode !== 'WALK') {
      badges += '<span class="badge">' + modeIcon(l.mode, 18) + escapeHtml(legBadgeLabel(l)) + '</span>'
    }
    if (i < trip.legs.length - 1) {
      const gap = gapMinutes(l.arrival, trip.legs[i + 1].departure)
      badges += '<span class="gap-badge">' + gap + '<span>min</span></span>'
    }
  }
  let summaryClass = 'summary'
  if (trip.cancelled) {
    summaryClass = 'summary cancelled'
  }
  let cancelledHtml = ''
  if (trip.cancelled) {
    let reason = ''
    if (trip.cancellationReason) {
      reason = ' — ' + escapeHtml(trip.cancellationReason)
    }
    cancelledHtml = '<div class="trip-cancelled">Cancelled' + reason + '</div>'
  }
  return `
    <div class="${summaryClass}">
      <div class="trip-head">
        <span class="trip-time">
          ${fmtTime(trip.departure)} <span class="muted">-</span> ${fmtTime(trip.arrival)}
        </span>
        <span class="trip-meta">
          ${metaSpan(TRANSFER_ICON, trip.transfers + 'x')}
          ${metaSpan(CLOCK_ICON, fmtDuration(trip.durationMin))}
        </span>
      </div>
      <div class="badges">${badges}</div>
      ${cancelledHtml}
    </div>`
}

function buildDetail(trip: Trip): string {
  let from = ''
  if (trip.legs[0]) {
    from = trip.legs[0].origin
  }
  let to = ''
  if (trip.legs[trip.legs.length - 1]) {
    to = trip.legs[trip.legs.length - 1].destination
  }
  let route = ''
  for (let i = 0; i < trip.legs.length; i++) {
    const leg = trip.legs[i]
    route += legCard(leg, i)
    if (i < trip.legs.length - 1) {
      route += transferBlock(leg, trip.legs[i + 1])
    }
  }
  return `
    <header class="detail-header">
      <button id="detail-back" type="button" aria-label="${tr('ariaBack')}" class="icon-btn">${BACK_ICON}</button>
      <div class="detail-title">
        <div class="detail-title-main">${escapeHtml(from)} - ${escapeHtml(to)}</div>
        <div class="detail-title-sub">${fmtDateHeader(trip.departure)}</div>
      </div>
      <span class="header-spacer"></span>
    </header>
    <main class="detail-main">
      ${buildSummary(trip)}
      <div class="spacer-8"></div>
      ${route}
    </main>`
}

function showDetail(trip: Trip, idx: number = detailTrips.indexOf(trip)) {
  stopsView.hidden = true
  detailView.innerHTML = buildDetail(trip)
  const backBtn = detailView.querySelector<HTMLButtonElement>('#detail-back')
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      detailView.hidden = true
      if (view === 'detail') {
        view = 'list'
        renderLens().catch(function (err) {
          console.error(err)
        })
      }
    })
  }
  const taps = detailView.querySelectorAll<HTMLDivElement>('.leg-service--tap')
  taps.forEach(function (el) {
    const legIdx = Number(el.dataset.leg)
    const leg = trip.legs[legIdx]
    if (!leg) {
      return
    }
    el.addEventListener('click', function () {
      showStops(leg)
    })
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        showStops(leg)
      }
    })
  })
  detailView.scrollTop = 0
  detailView.hidden = false
  mirrorDetailToLens(idx)
}

const STOP_START_ICON = icon('Navigate Feature Icon/Location', { size: 18 })
const STOP_END_ICON = icon('Navigate Feature Icon/End Location', { size: 18 })

function stopTimeLine(iso: string, delayMin: number): string {
  if (!iso) {
    return ''
  }
  return '<span class="stop-time">' + fmtTime(iso) + delayBadge(delayMin) + '</span>'
}

function stopRow(stop: LegStop, i: number, total: number, boardIdx: number, exitIdx: number): string {
  const isFirst = i === 0
  const isLast = i === total - 1
  const isBoard = i === boardIdx
  const isExit = i === exitIdx
  const inSegment = i >= boardIdx && i <= exitIdx

  let times = ''
  if (isFirst) {
    times = stopTimeLine(stop.departure, stop.departureDelayMin)
  } else if (isLast) {
    times = stopTimeLine(stop.arrival, stop.arrivalDelayMin)
  } else {
    times = stopTimeLine(stop.arrival, stop.arrivalDelayMin) + stopTimeLine(stop.departure, stop.departureDelayMin)
  }
  let timesClass = 'stop-times'
  if (!inSegment) {
    timesClass = 'stop-times stop-times--muted'
  }

  let lineTop = '<span class="stop-line"></span>'
  if (isFirst) {
    lineTop = '<span class="stop-line stop-line--hidden"></span>'
  } else if (!(i > boardIdx && i <= exitIdx)) {
    lineTop = '<span class="stop-line stop-line--muted"></span>'
  }
  let lineBottom = '<span class="stop-line"></span>'
  if (isLast) {
    lineBottom = '<span class="stop-line stop-line--hidden"></span>'
  } else if (!(i >= boardIdx && i < exitIdx)) {
    lineBottom = '<span class="stop-line stop-line--muted"></span>'
  }

  let dotClass = 'stop-dot'
  let nameClass = 'stop-name'
  let marker = ''
  if (isBoard) {
    dotClass = 'stop-dot stop-dot--end'
    nameClass = 'stop-name stop-name--end'
    marker = '<span class="stop-marker">' + STOP_START_ICON + tr('boarding') + '</span>'
  } else if (isExit) {
    dotClass = 'stop-dot stop-dot--end'
    nameClass = 'stop-name stop-name--end'
    marker = '<span class="stop-marker">' + STOP_END_ICON + tr('disembark') + '</span>'
  } else if (!inSegment) {
    dotClass = 'stop-dot stop-dot--muted'
    nameClass = 'stop-name stop-name--muted'
  }

  let rowId = ''
  if (isBoard) {
    rowId = ' id="stop-board"'
  }

  return `
    <div class="stop"${rowId}>
      <div class="${timesClass}">${times}</div>
      <div class="stop-rail">
        ${lineTop}
        <span class="${dotClass}"></span>
        ${lineBottom}
      </div>
      <div class="stop-body">
        <span class="${nameClass}">${escapeHtml(stop.name)}</span>
        ${platformBadge(stop.track)}
        ${marker}
      </div>
    </div>`
}

function buildStops(leg: TripLeg, stops: LegStop[], boardIdx: number, exitIdx: number): string {
  let rows = ''
  for (let i = 0; i < stops.length; i++) {
    rows += stopRow(stops[i], i, stops.length, boardIdx, exitIdx)
  }
  return `
    <header class="detail-header">
      <button id="stops-back" type="button" aria-label="${tr('ariaBack')}" class="icon-btn">${BACK_ICON}</button>
      <div class="detail-title">
        <div class="detail-title-main">${escapeHtml(leg.displayName)}</div>
        <div class="detail-title-sub">${tr('connectorTo')} ${escapeHtml(leg.direction)}</div>
      </div>
      <span class="header-spacer"></span>
    </header>
    <main class="detail-main">
      <div class="stops-list">${rows}</div>
    </main>`
}

function bindStopsBack() {
  const backBtn = stopsView.querySelector<HTMLButtonElement>('#stops-back')
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      stopsView.hidden = true
    })
  }
}

function indexByName(stops: LegStop[], name: string): number {
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].name === name) {
      return i
    }
  }
  return -1
}

let stopsToken = 0

function showStops(leg: TripLeg) {
  if (!leg || leg.stops.length === 0) {
    return
  }
  stopsToken++
  const token = stopsToken
  stopsView.innerHTML = buildStops(leg, leg.stops, 0, leg.stops.length - 1)
  bindStopsBack()
  stopsView.scrollTop = 0
  stopsView.hidden = false

  if (!leg.trainNumber) {
    return
  }
  fetchJourney(leg.trainNumber, { dateTime: leg.departure, lang: getLang() })
    .then(function (full) {
      if (token !== stopsToken || stopsView.hidden) {
        return
      }
      if (full.length === 0) {
        return
      }
      const boardIdx = indexByName(full, leg.origin)
      const exitIdx = indexByName(full, leg.destination)
      if (boardIdx < 0 || exitIdx < 0 || boardIdx > exitIdx) {
        return
      }
      stopsView.innerHTML = buildStops(leg, full, boardIdx, exitIdx)
      bindStopsBack()
      if (boardIdx > 0) {
        const boardEl = stopsView.querySelector<HTMLDivElement>('#stop-board')
        if (boardEl) {
          boardEl.scrollIntoView({ block: 'center' })
        }
      }
    })
    .catch(function (err) {
      console.error('fetchJourney failed:', err)
    })
}

function mirrorHomeToLens() {
  view = 'home'
  detailRoute = null
  detailTrips = []
  renderLens().catch(function (err) {
    console.error(err)
  })
}

function mirrorDetailToLens(idx: number) {
  if (idx < 0 || idx >= detailTrips.length) {
    return
  }
  tripIdx = idx
  view = 'detail'
  renderLens().catch(function (err) {
    console.error(err)
  })
}

const errorModal = document.createElement('div')
errorModal.id = 'error-modal'
errorModal.hidden = true
errorModal.className = 'modal-backdrop'
errorModal.innerHTML = `
  <div class="modal-card" role="alertdialog" aria-modal="true">
    <p class="modal-text"></p>
    <button type="button" class="modal-ok">${tr('ok')}</button>
  </div>`
document.body.appendChild(errorModal)

const errorModalText = errorModal.querySelector<HTMLParagraphElement>('.modal-text')!
function hideError() {
  errorModal.hidden = true
}
function showError(message: string) {
  errorModalText.textContent = message
  errorModal.hidden = false
  const okBtn = errorModal.querySelector<HTMLButtonElement>('.modal-ok')
  if (okBtn) {
    okBtn.focus()
  }
}
const modalOk = errorModal.querySelector<HTMLButtonElement>('.modal-ok')
if (modalOk) {
  modalOk.addEventListener('click', hideError)
}
errorModal.addEventListener('click', function (e) {
  if (e.target === errorModal) {
    hideError()
  }
})
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !errorModal.hidden) {
    hideError()
  }
})

const DAY_MS = 86400000
const WHEEL_ITEM_H = 56

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

function dayLabel(d: Date): string {
  const today = startOfDay(new Date())
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / DAY_MS)
  if (diff === 0) {
    return tr('today')
  }
  if (diff === 1) {
    return tr('tomorrow')
  }
  if (diff === -1) {
    return tr('yesterday')
  }
  return d.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatPlanValue(): string {
  if (!planDateTime) {
    return ' ' + tr('now')
  }
  const time = planDateTime.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return ' ' + dayLabel(planDateTime) + ' ' + time
}

const depLabelEl = document.getElementById('dep-label')
const depValueEl = document.getElementById('dep-value')

function updateDepBox() {
  if (depLabelEl) {
    if (planTimeMode === 'arrival') {
      depLabelEl.textContent = tr('arrivalLabel')
    } else {
      depLabelEl.textContent = tr('departureLabel')
    }
  }
  if (depValueEl) {
    depValueEl.textContent = formatPlanValue()
  }
}

const CHEVRON_LEFT = icon('Guide System/Chevron - Back', { size: 22 })
const CHEVRON_RIGHT = icon('Guide System/Chevron - Drill-in', { size: 22 })

const timeModal = document.createElement('div')
timeModal.id = 'time-modal'
timeModal.hidden = true
timeModal.className = 'modal-backdrop'
timeModal.innerHTML = `
  <div class="time-card" role="dialog" aria-modal="true" aria-label="${tr('ariaChooseTime')}">
    <div class="time-tabs">
      <button id="tab-dep" type="button" class="time-tab">${tr('tabDeparture')}</button>
      <button id="tab-arr" type="button" class="time-tab">${tr('tabArrival')}</button>
    </div>
    <div class="time-picker">
      <div class="wheels">
        <div class="wheel-overlay"></div>
        <div id="wheel-hour" class="wheel" aria-label="${tr('ariaHour')}"></div>
        <span class="wheel-colon">:</span>
        <div id="wheel-min" class="wheel" aria-label="${tr('ariaMinute')}"></div>
      </div>
      <button id="time-now" type="button" class="time-now">${tr('nowButton')}</button>
    </div>
    <div class="time-date">
      <button id="date-prev" type="button" class="date-arrow" aria-label="${tr('ariaPrevDay')}">${CHEVRON_LEFT}</button>
      <span id="date-label" class="date-label">${tr('today')}</span>
      <button id="date-next" type="button" class="date-arrow" aria-label="${tr('ariaNextDay')}">${CHEVRON_RIGHT}</button>
    </div>
    <div class="time-actions">
      <button id="time-cancel" type="button" class="time-cancel">${tr('cancel')}</button>
      <button id="time-done" type="button" class="time-done">${tr('done')}</button>
    </div>
  </div>`
document.body.appendChild(timeModal)

let pickerMode: TimeMode = 'departure'
let pickerDate: Date = startOfDay(new Date())
let pickerIsNow = true

const hourEl = timeModal.querySelector<HTMLDivElement>('#wheel-hour')!
const minEl = timeModal.querySelector<HTMLDivElement>('#wheel-min')!
const tabDep = timeModal.querySelector<HTMLButtonElement>('#tab-dep')!
const tabArr = timeModal.querySelector<HTMLButtonElement>('#tab-arr')!
const nowBtn = timeModal.querySelector<HTMLButtonElement>('#time-now')!
const dateLabelEl = timeModal.querySelector<HTMLSpanElement>('#date-label')!
const datePrev = timeModal.querySelector<HTMLButtonElement>('#date-prev')!
const dateNext = timeModal.querySelector<HTMLButtonElement>('#date-next')!

function clearNow() {
  if (pickerIsNow) {
    pickerIsNow = false
    updateNowState()
  }
}

interface Wheel {
  set: (i: number) => void
  get: () => number
}

function buildWheel(el: HTMLElement, count: number): Wheel {
  el.innerHTML = ''
  const top = document.createElement('div')
  top.className = 'wheel-spacer'
  el.appendChild(top)
  for (let i = 0; i < count; i++) {
    const item = document.createElement('div')
    item.className = 'wheel-item'
    let txt = String(i)
    if (txt.length < 2) {
      txt = '0' + txt
    }
    item.textContent = txt
    el.appendChild(item)
  }
  const bot = document.createElement('div')
  bot.className = 'wheel-spacer'
  el.appendChild(bot)

  function clampIdx(i: number): number {
    if (i < 0) {
      return 0
    }
    if (i > count - 1) {
      return count - 1
    }
    return i
  }
  function markCenter() {
    const idx = clampIdx(Math.round(el.scrollTop / WHEEL_ITEM_H))
    for (let i = 0; i < count; i++) {
      const c = el.children[i + 1] as HTMLElement
      if (i === idx) {
        c.classList.add('sel')
      } else {
        c.classList.remove('sel')
      }
    }
  }
  el.addEventListener('scroll', markCenter)
  el.addEventListener('pointerdown', clearNow)
  el.addEventListener('wheel', clearNow)
  el.addEventListener('touchstart', clearNow, { passive: true })

  return {
    set: function (i: number) {
      el.scrollTop = clampIdx(i) * WHEEL_ITEM_H
      markCenter()
    },
    get: function (): number {
      return clampIdx(Math.round(el.scrollTop / WHEEL_ITEM_H))
    },
  }
}

const hourWheel = buildWheel(hourEl, 24)
const minWheel = buildWheel(minEl, 60)

function updateTabs() {
  if (pickerMode === 'departure') {
    tabDep.classList.add('sel')
    tabArr.classList.remove('sel')
  } else {
    tabArr.classList.add('sel')
    tabDep.classList.remove('sel')
  }
}

function updateNowState() {
  if (pickerIsNow) {
    nowBtn.classList.add('sel')
  } else {
    nowBtn.classList.remove('sel')
  }
}

function updateDateRow() {
  dateLabelEl.textContent = dayLabel(pickerDate)
  datePrev.disabled = sameDay(pickerDate, new Date())
}

function openTimeModal() {
  pickerMode = planTimeMode
  let base = new Date()
  if (planDateTime) {
    base = new Date(planDateTime)
  }
  pickerDate = startOfDay(base)
  pickerIsNow = !planDateTime
  updateTabs()
  updateNowState()
  updateDateRow()
  timeModal.hidden = false
  hourWheel.set(base.getHours())
  minWheel.set(base.getMinutes())
}

function closeTimeModal() {
  timeModal.hidden = true
}

function setNow() {
  pickerIsNow = true
  const now = new Date()
  pickerDate = startOfDay(now)
  hourWheel.set(now.getHours())
  minWheel.set(now.getMinutes())
  updateNowState()
  updateDateRow()
}

function commitTime() {
  planTimeMode = pickerMode
  if (pickerIsNow) {
    planDateTime = null
  } else {
    const d = new Date(pickerDate)
    d.setHours(hourWheel.get(), minWheel.get(), 0, 0)
    planDateTime = d
  }
  closeTimeModal()
  updateDepBox()
  if (results && results.children.length > 0) {
    planJourney().catch(function (err) {
      console.error(err)
    })
  } else if (view !== 'home') {
    openTripList().catch(function (err) {
      console.error(err)
    })
  }
}

tabDep.addEventListener('click', function () {
  pickerMode = 'departure'
  updateTabs()
})
tabArr.addEventListener('click', function () {
  pickerMode = 'arrival'
  updateTabs()
})
nowBtn.addEventListener('click', setNow)
datePrev.addEventListener('click', function () {
  if (sameDay(pickerDate, new Date())) {
    return
  }
  const d = new Date(pickerDate)
  d.setDate(d.getDate() - 1)
  pickerDate = startOfDay(d)
  clearNow()
  updateDateRow()
})
dateNext.addEventListener('click', function () {
  const d = new Date(pickerDate)
  d.setDate(d.getDate() + 1)
  pickerDate = startOfDay(d)
  clearNow()
  updateDateRow()
})
const timeCancel = timeModal.querySelector<HTMLButtonElement>('#time-cancel')
if (timeCancel) {
  timeCancel.addEventListener('click', closeTimeModal)
}
const timeDone = timeModal.querySelector<HTMLButtonElement>('#time-done')
if (timeDone) {
  timeDone.addEventListener('click', commitTime)
}
timeModal.addEventListener('click', function (e) {
  if (e.target === timeModal) {
    closeTimeModal()
  }
})

const depBox = document.getElementById('dep-box')
if (depBox) {
  depBox.addEventListener('click', openTimeModal)
}
updateDepBox()

async function planJourney() {
  if (!fromEl || !toEl) {
    return
  }
  if (!stationList.length) {
    setResults('<p class="notice">' + tr('loadingStations') + '</p>')
    return
  }
  const fromCode = resolveCode(fromEl)
  const toCode = resolveCode(toEl)
  if (!fromCode || !toCode) {
    showError(tr('errPickBoth'))
    return
  }
  if (fromCode === toCode) {
    showError(tr('errSameStation'))
    return
  }
  showPlanAgain(false)
  setResults('<p class="notice">' + tr('planning') + '</p>')
  const route: SavedRoute = {
    fromCode: fromCode,
    fromName: nameForCode(fromCode),
    toCode: toCode,
    toName: nameForCode(toCode),
  }
  detailRoute = route
  detailTrips = []
  detailStatus = 'loading'
  tripIdx = 0
  view = 'list'
  renderLens().catch(function (err) {
    console.error(err)
  })
  try {
    const trips = await fetchTrips(fromCode, toCode, tripOpts())
    renderTrips(trips)
    if (detailRoute === route) {
      detailTrips = trips
      if (trips.length) {
        detailStatus = 'ready'
      } else {
        detailStatus = 'error'
        detailError = tr('noDepartures')
      }
      renderLens().catch(function (err) {
        console.error(err)
      })
    }
    addRoute(route)
  } catch (e) {
    let msg = ''
    if (e instanceof Error) {
      msg = e.message
    } else {
      msg = String(e)
    }
    setResults('')
    showPlanAgain(true)
    showError(tr('errCouldNotPlan') + msg)
    if (detailRoute === route) {
      detailStatus = 'error'
      detailError = msg
      renderLens().catch(function (err) {
        console.error(err)
      })
    }
  }
}

const planBtn = document.getElementById('plan')
if (planBtn) {
  planBtn.addEventListener('click', function () {
    planJourney().catch(function (err) {
      console.error(err)
    })
  })
}

const clearBtn = document.getElementById('clear-search')
if (clearBtn) {
  clearBtn.addEventListener('click', function () {
    if (fromEl) {
      fromEl.value = ''
      delete fromEl.dataset.code
    }
    if (toEl) {
      toEl.value = ''
      delete toEl.dataset.code
    }
    setResults('')
    showPlanAgain(true)
    mirrorHomeToLens()
    if (fromEl) {
      fromEl.focus()
    }
  })
}

function onFieldEdited() {
  if (results && results.children.length) {
    results.innerHTML = ''
    showPlanAgain(true)
    mirrorHomeToLens()
  }
}
if (fromEl) {
  fromEl.addEventListener('input', onFieldEdited)
}
if (toEl) {
  toEl.addEventListener('input', onFieldEdited)
}

function selectSavedRoute(r: SavedRoute) {
  if (!fromEl || !toEl) {
    return
  }
  fromEl.value = r.fromName
  fromEl.dataset.code = r.fromCode
  toEl.value = r.toName
  toEl.dataset.code = r.toCode
  planJourney().catch(function (err) {
    console.error(err)
  })
}

function showPlanAgain(show: boolean) {
  const el = document.getElementById('home-sections')
  if (el) {
    el.hidden = !show
  }
}

function renderSavedRoutes() {
  const el = document.getElementById('saved')
  if (!el) {
    return
  }
  if (savedRoutes.length === 0) {
    el.innerHTML = '<div class="empty-note">' + tr('noRecent') + '</div>'
    return
  }
  let html = ''
  for (let i = 0; i < savedRoutes.length; i++) {
    const r = savedRoutes[i]
    html +=
      '<div class="chip row-item row-divider" data-ri="' + i + '">' +
      '<span class="row-name">' + escapeHtml(r.fromName) + ' ' + icon('Guide System/Go', { size: 15, cls: 'muted' }) + ' ' + escapeHtml(r.toName) + '</span>' +
      '<button class="del menu-btn" data-ri="' + i + '" type="button" aria-label="' + tr('ariaRemoveRoute') + '">' + MENU_DOTS + '</button>' +
      '</div>'
  }
  el.innerHTML = html
  const chips = el.querySelectorAll<HTMLElement>('.chip')
  chips.forEach(function (row) {
    row.addEventListener('click', function () {
      selectSavedRoute(savedRoutes[Number(row.dataset.ri)])
    })
  })
  const dels = el.querySelectorAll<HTMLElement>('.del')
  dels.forEach(function (del) {
    del.addEventListener('click', function (e) {
      e.stopPropagation()
      const r = savedRoutes[Number(del.dataset.ri)]
      if (r) {
        removeRoute(r.fromCode, r.toCode)
      }
    })
  })
}
renderSavedRoutes()

function useFavorite(f: Favorite) {
  if (!toEl) {
    return
  }
  toEl.value = f.name
  toEl.dataset.code = f.code
}

function renderFavorites() {
  const el = document.getElementById('fav-list')
  if (!el) {
    return
  }
  if (favorites.length === 0) {
    el.innerHTML = '<div class="empty-note row-divider">' + tr('favEmpty') + '</div>'
    return
  }
  let html = ''
  for (let i = 0; i < favorites.length; i++) {
    const f = favorites[i]
    html +=
      '<div class="fav row-item row-divider" data-fi="' + i + '">' +
      '<span class="row-icon">' + iconSvg(f.icon, 22) + '</span>' +
      '<span class="row-name">' + escapeHtml(f.label) + '</span>' +
      '<button class="favmenu menu-btn" data-fi="' + i + '" type="button" aria-label="' + tr('ariaEditFav') + '">' + MENU_DOTS + '</button>' +
      '</div>'
  }
  el.innerHTML = html
  const favRows = el.querySelectorAll<HTMLElement>('.fav')
  favRows.forEach(function (row) {
    row.addEventListener('click', function () {
      useFavorite(favorites[Number(row.dataset.fi)])
    })
  })
  const menus = el.querySelectorAll<HTMLElement>('.favmenu')
  menus.forEach(function (menu) {
    menu.addEventListener('click', function (e) {
      e.stopPropagation()
      showFavEdit(Number(menu.dataset.fi))
    })
  })
}

const favAddBtn = document.getElementById('fav-add')
if (favAddBtn) {
  favAddBtn.addEventListener('click', function () {
    if (!favInput || !stationList.length) {
      return
    }
    const code = resolveCode(favInput)
    if (!code) {
      favInput.placeholder = tr('pickStationFirst')
      return
    }
    addFavorite({ code: code, name: nameForCode(code) })
    favInput.value = ''
    delete favInput.dataset.code
  })
}

const favEditView = document.createElement('div')
favEditView.id = 'fav-edit'
favEditView.hidden = true
favEditView.className = 'overlay overlay--top'
document.body.appendChild(favEditView)

function showFavEdit(index: number) {
  const fav = favorites[index]
  if (!fav) {
    return
  }
  let chosen: FavIcon = fav.icon
  function iconCard(kind: FavIcon, label: string): string {
    let cls = 'icon-card'
    if (kind === chosen) {
      cls = 'icon-card selected'
    }
    return `
    <button type="button" class="${cls}" data-icon="${kind}">
      ${iconSvg(kind, 26)}<span>${label}</span>
    </button>`
  }

  const safeLabel = escapeHtml(fav.label)
  favEditView.innerHTML = `
    <header class="detail-header">
      <button id="fav-back" type="button" aria-label="${tr('ariaBack')}" class="icon-btn">${BACK_ICON}</button>
      <div class="sheet-title">${tr('favLocationTitle')}</div>
      <span class="header-spacer"></span>
    </header>
    <main class="sheet-main">
      <div class="fav-preview">
        <span class="fav-preview-pill">${escapeHtml(fav.name)}</span>
      </div>

      <div class="field-label">${tr('nameLabel')}</div>
      <div class="name-field">
        <input id="fav-name" type="text" value="${safeLabel}" class="name-input" />
        <button id="fav-name-clear" type="button" aria-label="${tr('ariaClearName')}" class="name-clear">${icon('Edit & Settings Icons/Cross', { size: 18 })}</button>
      </div>

      <div class="field-label mt">${tr('iconLabel')}</div>
      <div id="icon-cards" class="icon-cards">
        ${iconCard('home', tr('favHome'))}${iconCard('work', tr('favWork'))}${iconCard('default', tr('favDefault'))}
      </div>

      <button id="fav-save" type="button" class="sheet-save">${tr('save')}</button>
      <button id="fav-remove" type="button" class="sheet-remove">${tr('removeFav')}</button>
    </main>`

  function close() {
    favEditView.hidden = true
  }
  const backBtn = favEditView.querySelector<HTMLButtonElement>('#fav-back')
  if (backBtn) {
    backBtn.addEventListener('click', close)
  }
  const nameClear = favEditView.querySelector<HTMLButtonElement>('#fav-name-clear')
  if (nameClear) {
    nameClear.addEventListener('click', function () {
      const input = favEditView.querySelector<HTMLInputElement>('#fav-name')
      if (input) {
        input.value = ''
        input.focus()
      }
    })
  }
  const cards = favEditView.querySelectorAll<HTMLButtonElement>('.icon-card')
  cards.forEach(function (card) {
    card.addEventListener('click', function () {
      chosen = card.dataset.icon as FavIcon
      const allCards = favEditView.querySelectorAll<HTMLButtonElement>('.icon-card')
      allCards.forEach(function (c) {
        if (c.dataset.icon === chosen) {
          c.classList.add('selected')
        } else {
          c.classList.remove('selected')
        }
      })
    })
  })
  const saveBtn = favEditView.querySelector<HTMLButtonElement>('#fav-save')
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      const input = favEditView.querySelector<HTMLInputElement>('#fav-name')
      let newLabel = fav.name
      if (input && input.value.trim()) {
        newLabel = input.value.trim()
      }
      fav.label = newLabel
      fav.icon = chosen
      persistFavorites()
      renderFavorites()
      close()
    })
  }
  const removeBtn = favEditView.querySelector<HTMLButtonElement>('#fav-remove')
  if (removeBtn) {
    removeBtn.addEventListener('click', function () {
      removeFavorite(fav.code)
      close()
    })
  }
  favEditView.scrollTop = 0
  favEditView.hidden = false
}

renderFavorites()
function setText(id: string, text: string) {
  const el = document.getElementById(id)
  if (el) {
    el.textContent = text
  }
}
function setPlaceholder(id: string, text: string) {
  const el = document.getElementById(id) as HTMLInputElement | null
  if (el) {
    el.placeholder = text
  }
}
function setAria(id: string, text: string) {
  const el = document.getElementById(id)
  if (el) {
    el.setAttribute('aria-label', text)
  }
}

function localizeStatic() {
  setPlaceholder('from', tr('from'))
  setPlaceholder('to', tr('to'))
  setAria('swap', tr('ariaSwap'))
  setText('plan-text', tr('plan'))
  setAria('clear-search', tr('ariaClear'))
  setText('fav-title', tr('favorites'))
  setPlaceholder('fav-input', tr('searchStation'))
  setText('fav-add', tr('add'))
  setText('again-title', tr('planAgain'))
  setAria('lang-toggle', tr('ariaLang'))
  updateDepBox()

  setText('tab-dep', tr('tabDeparture'))
  setText('tab-arr', tr('tabArrival'))
  setText('time-now', tr('nowButton'))
  setText('time-cancel', tr('cancel'))
  setText('time-done', tr('done'))
  setAria('wheel-hour', tr('ariaHour'))
  setAria('wheel-min', tr('ariaMinute'))
  setAria('date-prev', tr('ariaPrevDay'))
  setAria('date-next', tr('ariaNextDay'))

  const okBtn = errorModal.querySelector<HTMLButtonElement>('.modal-ok')
  if (okBtn) {
    okBtn.textContent = tr('ok')
  }
}

function applyLanguage() {
  localizeStatic()
  renderLangMenu()
  renderSavedRoutes()
  renderFavorites()
  renderLens().catch(function (err) {
    console.error(err)
  })
}

const langToggle = document.getElementById('lang-toggle')
const langMenu = document.getElementById('lang-menu') as HTMLUListElement | null

function closeLangMenu() {
  if (langMenu) {
    langMenu.hidden = true
  }
  if (langToggle) {
    langToggle.setAttribute('aria-expanded', 'false')
  }
}

function selectLang(code: Lang) {
  closeLangMenu()
  if (code === getLang()) {
    return
  }
  setLang(code)
  persistLang()
  applyLanguage()
}

function renderLangMenu() {
  if (!langMenu) {
    return
  }
  langMenu.innerHTML = ''
  for (const l of LANGS) {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    li.className = 'option'
    const current = l.code === getLang()
    li.setAttribute('aria-selected', current ? 'true' : 'false')
    if (current) {
      li.classList.add('active')
    }
    const name = document.createElement('span')
    name.textContent = l.label
    name.className = 'option-name'
    li.appendChild(name)
    li.addEventListener('click', function () {
      selectLang(l.code)
    })
    langMenu.appendChild(li)
  }
}

if (langToggle && langMenu) {
  renderLangMenu()
  langToggle.addEventListener('click', function (e) {
    e.stopPropagation()
    const willOpen = langMenu.hidden
    if (willOpen) {
      renderLangMenu()
    }
    langMenu.hidden = !willOpen
    langToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
  })
  document.addEventListener('click', function (e) {
    if (langMenu.hidden) {
      return
    }
    const target = e.target as Node
    if (!langToggle.contains(target) && !langMenu.contains(target)) {
      closeLangMenu()
    }
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !langMenu.hidden) {
      closeLangMenu()
    }
  })
}

await renderLens().catch(function (err) {
  console.error(err)
})
if (!cleanedUp) {
  clockTimer = setInterval(function () {
    renderLens().catch(function (err) {
      console.error(err)
    })
  }, CLOCK_MS)
  tripsTimer = setInterval(function () {
    refreshOpenTrips().catch(function (err) {
      console.error(err)
    })
  }, TRIPS_REFRESH_MS)
}
