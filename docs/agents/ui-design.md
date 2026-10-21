# UI design

The UI is everything a user sees and touches: enx-ui (the marketing site and the app pages under `src/app/(app)/`) and enx-chrome's own surfaces (popup, side panel, word popover). These rules are how the owner's UI principles look in code; the principles themselves, P-6 among them, are in [principles.md](principles.md). Icons have their own rules in [icons.md](icons.md). Apply every rule to the page or surface you touch.

## Colour

Brand colour leads (P-6): design every element around the Catglish brand teal, and reach for a neutral only where nothing should draw the eye.

- **The palette.** `--brand-hue: 200` defines the brand; every brand shade, light and dark, derives from it. It lives in `enx-ui/src/app/globals.css` and `enx-chrome/src/index.css`, and the two values stay equal. Hue 200 keeps Catglish clear of the 239–270 band where Quizlet, Readwise, Anki, Busuu and Rosetta Stone sit (ADR-013, as revised).
- **Tokens only.** Take every colour from the theme tokens: in enx-ui `src/app/globals.css` (`bg-brand`, `text-brand`, `text-muted-foreground`, `text-destructive`, `bg-muted`, `border-input`, …), in enx-chrome `src/index.css` (`brand`, `brand-muted`, `success`, …). They carry the dark theme. Raw palette classes (`text-gray-500`, `text-red-600`) stay light in dark mode; replace any you find on a page you touch. A colour with no token yet gets one in the same change, in both files when both sub-projects need it.
- **Action hierarchy.** A screen's primary action is its one solid `brand` button. Secondary actions are `outline`, tertiary `ghost`. Links, selected and active states, progress and icon accents use `brand` (or its muted tint for a background).
- **Meaning colours.** `destructive` red marks a delete or a real failure; amber marks a warning (a signed-out state, a missing extension); `success` green marks "known". Each keeps its one meaning.
- **Migrate on touch.** Near-black `default` buttons and other off-brand accents are legacy. A change that touches a page or surface moves that page's colours to this scheme in the same PR; untouched pages wait their turn.
- **On the host page** (enx-chrome marks inside someone else's site) colours follow ADR-054: warm yellow for a temporary location, the purple underline ramp for review stages only, brand for emphasis inside our own surfaces.

## Interaction

Every control answers the hand: hover, pressed (`active:`) and `focus-visible` states, and a disabled look while it can't run. For buttons these come from `buttonVariants` in `src/components/ui/button.tsx`; a custom control supplies its own.

## enx-ui app pages

Rules for the layout and visual hierarchy of an app page. They come from the Word Lookup redesign (#246) and the Rephrase redesign.

Good pages to copy: Word Lookup (`lookup/`) for a search box with a result card, Reader (`reader/page.tsx`) for a text box.

### Frame

- **Page shell.** `PageHeader` first: the sidebar label is the title and one line says what the page is for. Then the content column: `container mx-auto max-w-2xl space-y-6 p-6 md:p-8`, unless the page needs a wider column for its own reasons (Reader).
- **One frame per thing.** Each thing on the page has exactly one visible border. An input's own border is its frame, so a lone input or text box sits directly on the page, not inside a `Card`. A `Card` holds a result or a group of related rows. A card never sits inside another card or another bordered box.
- **Composer.** A text box and its controls form one surface: a single rounded border (`rounded-xl border bg-card shadow-xs`, ring on `focus-within`) around a borderless `<textarea>` with the toolbar row inside the same border. The textarea grows with its text (`field-sizing-content`, a `min-h-*` and a `max-h-*`, `resize-none`).

### Quiet chrome

The user's text and the result are what the eye lands on; everything else stays quiet until it is needed.

- **Labels.** When the `PageHeader` line and the placeholder already say what goes in a field, its `<Label>` is `sr-only`. The accessible name stays, so tests find the field by it.
- **Counters** show from 90% of the limit (`nearLimit`, as Reader does) and turn `text-destructive` past it.
- **Secondary actions** (Clear, Reset) render only when they would do something. Primary actions stay visible and are disabled until they can run.
- **Keyboard hints** ("Enter to rephrase · Shift+Enter for a new line") are one `text-xs text-muted-foreground` line, hidden below `sm`, where there is no hardware keyboard.
- **Icon-only actions** (Copy, Play, Remove) are `variant="ghost" size="icon"` buttons with `aria-label` and `title`. Use them for actions repeated on every row; text buttons repeated down a list are noise.

### States

Every request a page makes has four states. Design each one:

1. **Empty.** Say what to do, and offer a way to see the page work without effort: Reader's "Try a sample", example inputs that fill the box. An example fills the input only; it never submits a request that spends credits.
2. **Loading.** The primary button says what is happening ("Rephrasing…") and a skeleton shaped like the result holds its place, so the page doesn't jump when the result arrives.
3. **Error.** The message from `src/lib/apiErrors.ts` or the API's own `message`, in `text-destructive`, plus the action that fixes it: a 402 links to `/billing`.
4. **Result.** The answer is the headline: the largest text, at the top of its card, with its main action beside it. Supporting facts (status, counts, ids, register labels) are small and muted, in a label line or a footer.

## Checking it

Layout, overflow and colour need a real browser (AGENTS.md, Tests). An enx-ui page redesign adds a Playwright spec, signed in with the API mocked, in the style of `e2e/word-lookup.spec.ts`: at 375px wide the page doesn't scroll sideways and the controls stay on screen. The PR lists what was checked by eye at desktop width and in dark mode; for an enx-chrome surface, what was checked in a real Chrome.
