# Icons

One concept, one icon, in every surface: the word popover, the Side Panel, the popup and enx-ui. enx-chrome draws from `@heroicons/react`, enx-ui from `lucide-react`; each row names the matching glyph in both sets.

Before placing an icon, find its concept below and use that row's icon. A concept with no row gets a new row here in the same change, with a glyph no other row uses.

## Concepts

| Concept | enx-chrome (heroicons) | enx-ui (lucide) | Where |
| --- | --- | --- | --- |
| Look up a word or phrase | `MagnifyingGlassIcon` | `Search` | Word Lookup nav and tile; Side Panel phrase-lookup button |
| Lookup count (review progress, ADR-011) | `ArrowPathRoundedSquareIcon` + bare number | `Repeat` + bare number | word popover, Side Panel card, Word List. Title and screen-reader text: "Looked up N times" |
| AI does this | `SparklesIcon` | `Sparkles` | "Look up with AI", AI badge; Rephrase nav and tile |
| Turn Catglish on for this page (learning mode) | `CursorArrowRaysIcon` | `MousePointerClick` | popup "Read with Catglish" |
| Word highlight (underlines) | `UnderlineIcon` | `Underline` | popup "Highlight looked-up words" toggle |
| External dictionary (Youdao) | `BookOpenIcon` | `BookOpen` | word popover "Youdao" button |
| Reader (pasted text, a document) | `DocumentTextIcon` | `FileText` | Reader nav and tile, Reader document rows |
| Word List | — | `BookText` | Word List nav |
| Pronunciation | `SpeakerWaveIcon` | `Volume2` | word popover, Side Panel card |
| Translate the sentence in the Side Panel | `SidePanelTranslateIcon` (custom) | — | word popover, selection hint |
| Open the Side Panel | `SidePanelIcon` (custom, `Popup.tsx`) | — | popup |
| Saved page | `BookmarkIcon` (outline = not saved, solid = saved) | `Bookmark` | popup Save card, Saved Pages |
| Reading stats | `ChartBarIcon` | `BarChart3` | Reading Stats nav |
| Done, on, known | `CheckIcon` / `CheckCircleIcon` (status) | `Check` | "Catglish is on", Mark as known, onboarding steps |
| Back to learning | `ArrowUturnLeftIcon` | `Undo2` | Mark as learning |
| Delete something kept (server data) | `TrashIcon` | `Trash2` | Remove from Word List, delete a saved page or document |
| Close or dismiss something transient | `XMarkIcon` | `X` | close the word popover, remove a Side Panel card (cards are not persisted, ADR-023) |
| Needs a plan (paywalled) | `LockClosedIcon` | `Lock` | "Look up with AI" without credits |
| Private to you | `ShieldCheckIcon` | `ShieldCheck` | Reader's "Only you can see it" note |
| A website | `GlobeAltIcon` | `Globe` | popup "Always enable on this site"; "Back to site" nav |
| Opens in a new tab | `ArrowTopRightOnSquareIcon` | `ExternalLink` | popup header link to the site |
| Next step, go on | `ArrowRightIcon` | `ArrowRight` | sign-in button |
| Row leads somewhere | `ChevronRightIcon` | `ChevronRight` | popup "Open side panel", Home tiles |
| The extension itself | `PuzzlePieceIcon` | `Puzzle` | Reader's "needs the extension" notice |
| Settings | `Cog6ToothIcon` | `Settings` | popup header, Settings nav |
| Billing | `CreditCardIcon` | `CreditCard` | Billing nav |
| Sign out | `ArrowRightOnRectangleIcon` | — | popup |
| More actions | `EllipsisHorizontalIcon` | `MoreHorizontal` | Word List row menu |
| Edit | `PencilIcon` | `Pencil` | Reader "Edit text" |
| Explanation | `InformationCircleIcon` | `Info` | Reading Stats footnote |
| Open the navigation drawer | — | `Menu` | top bar on mobile |
| Admin: dictionary / AI definitions / page reports / users | — | `Wrench` / `ClipboardCheck` / `AlertTriangle` / `Users` | admin nav |

## Style

- enx-chrome: inline icons at 16px or smaller, beside text or numbers, come from `20/solid`; icons in the popup's 32px tiles and on buttons come from `24/outline`. The custom side-panel icons copy the `24/outline` stroke.
- An icon beside visible text is decorative: `aria-hidden="true"`. An icon-only button carries `aria-label`, and `title` when a hover hint helps.
- A count or state shown as icon + number keeps its words for hover and screen readers: `title` on the wrapper and an `sr-only` span, as the lookup count does.
