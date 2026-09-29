import { SITE } from '@/lib/site'

// Logo dot + product name + release-stage badge. Shared by the marketing
// header and the app sidebar so the badge comes and goes in one place.
export default function BrandMark() {
  return (
    <>
      <span
        aria-hidden
        className="inline-block h-5 w-5 rounded-full bg-brand ring-2 ring-brand/25"
      />
      {SITE.name}
      {SITE.stage && (
        <span className="rounded-full border border-brand/40 px-1.5 py-px text-[10px] font-medium uppercase leading-4 tracking-wide text-brand">
          {SITE.stage}
        </span>
      )}
    </>
  )
}
