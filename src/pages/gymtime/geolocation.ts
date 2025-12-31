export const setCityFromGeolocation = async (locationInput: HTMLInputElement) => {
  if (!navigator.geolocation) {
    console.error('Geolocation is not supported')
    return
  }

  navigator.geolocation.getCurrentPosition(async ({ coords: { latitude, longitude } }) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })

      if (res.ok) {
        const data = await res.json()
        const city =
          data.address.city ||
          data.address.town ||
          data.address.village ||
          data.address.hamlet ||
          data.address.locality ||
          data.address.county ||
          data.display_name

        if (city) {
          locationInput.value = city
        }
      }
    } catch (error) {
      console.error('Could not determine city of user', error)
    }
  })
}
