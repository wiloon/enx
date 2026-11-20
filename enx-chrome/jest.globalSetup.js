// Pin a timezone far from UTC so tests can tell local dates from UTC dates.
export default async function globalSetup() {
  process.env.TZ = 'America/Los_Angeles'
}
