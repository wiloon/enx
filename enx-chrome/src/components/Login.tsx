import { useUser } from '@clerk/chrome-extension'
import { errorAtom } from '@/store/atoms'
import { useAtom } from 'jotai'
import { useEffect, type ReactNode } from 'react'
import { AcademicCapIcon, ArrowRightIcon } from '@heroicons/react/24/outline'

interface LoginProps {
  onLoginSuccess?: () => void
  /** Rendered once the user is signed in. */
  children?: ReactNode
}

/**
 * Auth gate for the popup. Shows a loading placeholder, then either the
 * sign-in card (signed out) or `children` (signed in).
 */
export default function Login({ onLoginSuccess, children }: LoginProps) {
  const { isLoaded, isSignedIn } = useUser()
  const [error] = useAtom(errorAtom)

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      onLoginSuccess?.()
    }
  }, [isLoaded, isSignedIn, onLoginSuccess])

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-slate-400">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
        加载中…
      </div>
    )
  }

  if (isSignedIn) {
    return <>{children}</>
  }

  // OAuth (Google/GitHub) can't complete inside the extension popup -- the
  // popup is destroyed the moment it loses focus. Sign in on the website
  // instead (full-page Clerk UI, OAuth works there); the extension then picks
  // up the session automatically via ClerkProvider `syncHost`.
  //
  // ADR-020: the background service worker opens the tab (the popup is already
  // gone by the time chrome.tabs.create resolves), records the tab the user
  // came from, and switches focus back once /extension/connected reports the
  // sign-in.
  const openWebSignIn = () => {
    chrome.runtime.sendMessage({ action: 'openWebSignIn' })
  }

  return (
    <div className="px-4 py-7">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-500/20">
          <AcademicCapIcon className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-800">
          登录 ENX
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          登录后即可在阅读网页时高亮生词、随点随查。
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={openWebSignIn}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 py-2.5 text-sm font-medium text-white shadow-md shadow-sky-500/25 transition hover:brightness-105 active:scale-[0.99]"
      >
        在网页中登录
        <ArrowRightIcon className="h-4 w-4" />
      </button>
      <p className="mt-2.5 text-center text-[11px] leading-relaxed text-slate-400">
        将打开一个新标签页。在那里完成登录后回到此处，弹窗会自动刷新。
      </p>
    </div>
  )
}
