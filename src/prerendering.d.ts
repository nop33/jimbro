// Set while Chromium prerenders the page for a Speculation Rules prerender, until the tap shows it. TypeScript's DOM
// types don't declare it yet, and browsers without prerendering leave it undefined.
interface Document {
  readonly prerendering?: boolean
}
