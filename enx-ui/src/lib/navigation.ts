// Leaves the app for an external page, such as a Stripe session. A seam of its
// own because jsdom's window.location cannot be replaced in a test.
export function redirectTo(url: string): void {
  window.location.assign(url)
}
