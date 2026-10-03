export type Lang = 'en' | 'nl'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
]

const en = {
  lensPrompt: 'Please set a route in the app OR select from a previous journey:',
  connectorTo: 'to',
  loadingTimes: 'Loading times...',
  cancelledCaps: 'CANCELLED',
  tripTimeLabel: 'Trip time:',
  transfers: 'Transfers',
  transfer: 'Transfer',
  etaLabel: 'ETA:',
  platformLabel: 'Platform:',
  tripLegLabel: 'Trip:',
  changeLabel: 'Change',
  minShort: 'min',
  hourShort: 'h',
  noDepartures: 'No departures found',

  modeBus: 'Bus',
  modeTram: 'Tram',
  modeMetro: 'Metro',
  modeFerry: 'Ferry',
  modeWalk: 'Walk',
  modeTrain: 'Train',

  crowdQuiet: 'Quiet',
  crowdBusy: 'Busy',
  crowdVeryBusy: 'Very busy',

  crowdUnknown: 'Crowdedness unknown',
  crowdCalm: 'Calm',
  crowdBusyInline: 'Busy',
  crowdCrowded: 'Crowded',

  stopsPlural: 'intermediate stops',
  stopsSingular: 'intermediate stop',
  boarding: 'Board here',
  disembark: 'Get off here',
  exitSideLabel: 'Exit side',
  exitSideLeft: 'left',
  exitSideRight: 'right',
  transferTime: 'Transfer time',
  walkToTransfer: 'Walk to transfer',
  walkToPlatform: 'Walk to platform',
  checkOutIn: 'Check out/in:',
  wait: 'Wait',

  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  now: 'now',
  departureLabel: 'Departure:',
  arrivalLabel: 'Arrival:',

  from: 'From',
  to: 'To',
  ariaSwap: 'Swap origin and destination',
  plan: 'Plan your journey',
  ariaClear: 'Clear search',
  favorites: 'Favorites',
  searchStation: 'Search a station',
  add: 'Add',
  planAgain: 'Plan again ...',
  ariaSaveFav: 'Save to favorites',
  ariaLang: 'Switch language',

  loadingStations: 'Loading stations…',
  errCouldNotLoadStations: 'Could not load stations. Try again when connected.',
  planning: 'Planning…',
  errPickBoth: 'Pick both a From and To station.',
  errSameStation: 'From and To are the same station.',
  errCouldNotPlan: 'Could not plan journey: ',
  noJourneys: 'No journeys found.',
  cancelled: 'Cancelled',
  noRecent: 'You have no recently planned journeys',
  ariaRemoveRoute: 'Remove route',
  favEmpty: 'Save favorite locations and plan directly.',
  ariaEditFav: 'Edit favorite',
  pickStationFirst: 'Pick a station first',

  favLocationTitle: 'Favorite location',
  nameLabel: 'Name',
  iconLabel: 'Icon',
  favHome: 'Home',
  favWork: 'Work',
  favDefault: 'Default',
  save: 'Save',
  removeFav: 'Remove from favorites',
  ariaBack: 'Back',
  ariaClearName: 'Clear',

  ok: 'OK',
  tabDeparture: 'Departure',
  tabArrival: 'Arrival',
  nowButton: 'Now',
  ariaPrevDay: 'Previous day',
  ariaNextDay: 'Next day',
  cancel: 'Cancel',
  done: 'Done',
  ariaChooseTime: 'Choose time',
  ariaHour: 'Hour',
  ariaMinute: 'Minute',
}

export type StringKey = keyof typeof en

const nl: Record<StringKey, string> = {
  lensPrompt: '',
  connectorTo: '',
  loadingTimes: '',
  cancelledCaps: 'GEANNULEERD',
  tripTimeLabel: '',
  transfers: '',
  transfer: '',
  etaLabel: '',
  platformLabel: '',
  tripLegLabel: '',
  changeLabel: '',
  minShort: 'min',
  hourShort: 'u',
  noDepartures: '',

  modeBus: '',
  modeTram: '',
  modeMetro: '',
  modeFerry: '',
  modeWalk: 'Lopen',
  modeTrain: '',

  crowdQuiet: '',
  crowdBusy: '',
  crowdVeryBusy: '',

  crowdUnknown: '',
  crowdCalm: '',
  crowdBusyInline: '',
  crowdCrowded: '',

  stopsPlural: '',
  stopsSingular: '',
  boarding: '',
  disembark: '',
  exitSideLabel: 'Uitstapzijde',
  exitSideLeft: 'links',
  exitSideRight: 'rechts',
  transferTime: 'Overstaptijd',
  walkToTransfer: '',
  walkToPlatform: '',
  checkOutIn: '',
  wait: 'Wachten',

  today: '',
  tomorrow: '',
  yesterday: '',
  now: '',
  departureLabel: '',
  arrivalLabel: '',

  from: '',
  to: '',
  ariaSwap: '',
  plan: '',
  ariaClear: '',
  favorites: '',
  searchStation: '',
  add: '',
  planAgain: '',
  ariaSaveFav: '',
  ariaLang: '',

  loadingStations: '',
  errCouldNotLoadStations: '',
  planning: '',
  errPickBoth: '',
  errSameStation: '',
  errCouldNotPlan: '',
  noJourneys: '',
  cancelled: 'Geannuleerd',
  noRecent: '',
  ariaRemoveRoute: '',
  favEmpty: '',
  ariaEditFav: '',
  pickStationFirst: '',

  favLocationTitle: '',
  nameLabel: '',
  iconLabel: '',
  favHome: '',
  favWork: '',
  favDefault: '',
  save: '',
  removeFav: '',
  ariaBack: '',
  ariaClearName: '',

  ok: '',
  tabDeparture: '',
  tabArrival: '',
  nowButton: '',
  ariaPrevDay: '',
  ariaNextDay: '',
  cancel: '',
  done: '',
  ariaChooseTime: '',
  ariaHour: '',
  ariaMinute: '',
}

const STRINGS: Record<Lang, Record<StringKey, string>> = { en, nl }

let current: Lang = 'en'

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
}

export function toggleLang(): Lang {
  current = current === 'en' ? 'nl' : 'en'
  return current
}

export function t(key: StringKey): string {
  return STRINGS[current][key] || en[key]
}

export function dateLocale(): string {
  return current === 'nl' ? 'nl-NL' : 'en-GB'
}
