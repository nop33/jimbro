// Gyms near the device, nearest first. They come from OpenStreetMap places tagged leisure=fitness_centre, through
// the Overpass API. With none nearby, or Overpass unreachable, the city from Nominatim stands in, as the place name
// the app filled in before it named gyms.
export interface NearbyGyms {
  gyms: Array<string>
  city?: string
}

const SEARCH_RADIUS_METERS = 300

interface OverpassElement {
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: { name?: string }
}

const currentPosition = () =>
  new Promise<GeolocationCoordinates>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve(coords), reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000
    })
  })

const gymsAround = async (latitude: number, longitude: number): Promise<Array<string>> => {
  const query = `[out:json][timeout:10];nwr["leisure"="fitness_centre"]["name"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});out tags center;`
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: new URLSearchParams({ data: query })
  })
  if (!res.ok) throw new Error(`Overpass answered ${res.status}`)
  const { elements } = (await res.json()) as { elements: Array<OverpassElement> }

  // Squared degrees, with longitude shrunk by latitude, are close enough to rank places a few hundred metres apart.
  const scale = Math.cos((latitude * Math.PI) / 180)
  const distance = ({ lat, lon }: { lat: number; lon: number }) =>
    (lat - latitude) ** 2 + ((lon - longitude) * scale) ** 2
  const ranked = elements
    .flatMap((element) => {
      const name = element.tags?.name?.trim()
      const { lat, lon } = element
      const point = element.center ?? (lat !== undefined && lon !== undefined ? { lat, lon } : undefined)
      return name && point ? [{ name, distance: distance(point) }] : []
    })
    .sort((left, right) => left.distance - right.distance)
  return [...new Set(ranked.map(({ name }) => name))]
}

const cityAt = async (latitude: number, longitude: number): Promise<string | undefined> => {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Language': 'en-US' } })
  if (!res.ok) return undefined
  const { address, display_name } = await res.json()
  return (
    address?.city ||
    address?.town ||
    address?.village ||
    address?.hamlet ||
    address?.locality ||
    address?.county ||
    display_name
  )
}

export const findNearbyGyms = async (): Promise<NearbyGyms> => {
  const { latitude, longitude } = await currentPosition()
  try {
    const gyms = await gymsAround(latitude, longitude)
    if (gyms.length > 0) return { gyms }
  } catch (error) {
    console.error('Could not look up gyms nearby', error)
  }
  return { gyms: [], city: await cityAt(latitude, longitude) }
}
