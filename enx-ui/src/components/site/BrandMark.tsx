import { SITE } from '@/lib/site'
import LogoMark from './LogoMark'

// Logo + product name + release-stage badge. Shared by the marketing
// header and the app sidebar so the badge comes and goes in one place.
export default function BrandMark() {
  return (
    <>
      <LogoMark className="h-6 w-6 shrink-0" />
      {SITE.name}
      {SITE.stage && (
        <span className="rounded-full border border-brand/40 px-1.5 py-px text-[10px] font-medium uppercase leading-4 tracking-wide text-brand">
          {SITE.stage}
        </span>
      )}
    </>
  )
}
