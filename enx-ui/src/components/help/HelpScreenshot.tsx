export default function HelpScreenshot({
  file,
  caption,
}: {
  file: string
  caption: string
}) {
  return (
    <figure data-screenshot={file} className="space-y-2">
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-brand/40 bg-brand/5 p-6 text-center text-sm text-muted-foreground sm:min-h-56">
        Screenshot coming soon: {caption}
      </div>
      <figcaption className="text-sm text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  )
}
