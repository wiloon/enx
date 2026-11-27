import type { Metadata } from 'next'
import Link from 'next/link'
import HelpScreenshot from '@/components/help/HelpScreenshot'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: `Install manually from a ZIP file — ${SITE.name}`,
}

export default function OfflineInstallPage() {
  const repositoryName = SITE.githubUrl.split('/').filter(Boolean).at(-1)
  const packageName = `${repositoryName}-<version>.zip`
  const legacyPackageName = `${SITE.name.toLowerCase()}-<version>.zip`

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          Install manually from a ZIP file
        </h1>
        <p className="text-lg text-muted-foreground">
          Use this method if you cannot access the Chrome Web Store. You need
          desktop Chrome and a downloaded extension ZIP.
        </p>
        <p>
          This installs {SITE.name} without the store. Signing in and online
          features still need an internet connection. If you can access the
          store,{' '}
          <Link href="/help/install">install from the Chrome Web Store</Link>{' '}
          instead for automatic updates.
        </p>
      </header>
      <section aria-labelledby="download" className="space-y-4">
        <h2 id="download" className="text-xl font-semibold">
          1. Download the extension ZIP
        </h2>
        <p>
          <a href={SITE.githubUrl} target="_blank" rel="noopener noreferrer">
            Open the GitHub project
          </a>{' '}
          and choose <strong>Releases</strong>, or{' '}
          <a
            href={`${SITE.githubUrl}/releases`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open extension releases
          </a>{' '}
          directly.
        </p>
        <p>
          Find the newest extension release. Its title starts with {SITE.name}{' '}
          extension and its tag starts with <code>chrome-v</code>. Other
          releases may belong to the website or server.
        </p>
        <p>
          Expand <strong>Assets</strong> and download the extension ZIP, named{' '}
          <code>{packageName}</code>, where <code>&lt;version&gt;</code> is the
          release version.
        </p>
        {packageName !== legacyPackageName && (
          <p>
            Earlier releases use the product name instead:{' '}
            <code>{legacyPackageName}</code>. Choose the extension ZIP attached
            to that release.
          </p>
        )}
        <p>
          Do not download <strong>Source code (zip)</strong>,{' '}
          <strong>Source code (tar.gz)</strong> or the <code>.sha256</code>{' '}
          checksum file as your installation package.
        </p>
        <HelpScreenshot
          file="offline/release-assets.png"
          caption="An extension release with Assets expanded and the extension ZIP highlighted."
        />
      </section>
      <section aria-labelledby="extract" className="space-y-4">
        <h2 id="extract" className="text-xl font-semibold">
          2. Extract the ZIP
        </h2>
        <p>
          Extract all files into a permanent folder on your computer. Open the
          extracted folder and find <code>manifest.json</code>. If there is
          another folder inside, open it until you reach the folder containing
          that file.
        </p>
        <p>
          Keep the extracted folder in place after installation. Chrome loads
          the extension from that folder; moving or deleting it can stop the
          extension from working.
        </p>
        <HelpScreenshot
          file="offline/extracted-folder.png"
          caption="The extracted extension folder with manifest.json visible directly inside it."
        />
      </section>
      <section aria-labelledby="load" className="space-y-4">
        <h2 id="load" className="text-xl font-semibold">
          3. Load it in Chrome
        </h2>
        <p>
          Open a new Chrome tab, type <code>chrome://extensions</code> into the
          address bar and press Enter.
        </p>
        <p>
          Turn on <strong>Developer mode</strong> in the top-right corner.
        </p>
        <p>
          Click Load unpacked, then select the extracted folder that directly
          contains <code>manifest.json</code>. Select the folder, not the ZIP
          file.
        </p>
        <p>
          Check that {SITE.name} appears on the Extensions page and is switched
          on. If Chrome cannot find the manifest, check that you extracted the
          ZIP and selected the correct folder.
        </p>
        <HelpScreenshot
          file="offline/load-unpacked.png"
          caption="Chrome’s Extensions page with Developer mode and Load unpacked highlighted."
        />
      </section>
      <section aria-labelledby="setup" className="space-y-4">
        <h2 id="setup" className="text-xl font-semibold">
          4. Finish setup
        </h2>
        <p>
          If Welcome opens automatically, continue there. Otherwise, open it
          below to sign in, pin the icon and try the sample article.
        </p>
        <p>
          <Link href="/welcome">Continue setup</Link> ·{' '}
          <Link href="/help/get-started">Read the getting-started guide</Link>
        </p>
      </section>
      <section aria-labelledby="updates" className="space-y-4">
        <h2 id="updates" className="text-xl font-semibold">
          Updating a manual installation
        </h2>
        <p>
          Manually installed extensions do not update automatically from the
          Chrome Web Store. Download a newer extension ZIP from Releases,
          extract it and replace the contents of the existing extension folder.
          Then return to Chrome’s Extensions page and click the reload icon on{' '}
          {SITE.name}. Refresh the article tabs where you use it.
        </p>
        <p>
          A work or school browser may prevent Developer mode or manual
          installation. If those controls are unavailable, contact your browser
          administrator.
        </p>
      </section>
    </article>
  )
}
