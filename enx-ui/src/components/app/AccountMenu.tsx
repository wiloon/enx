'use client'

import Link from 'next/link'
import { CircleUser, CreditCard, LogOut } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useMe } from '@/hooks/useMe'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import AccountAvatar from './AccountAvatar'

// The top bar's account menu (#211): who is signed in, Account, Billing and
// Sign out. Sign out never waits for GET /api/me; while it is pending or has
// failed the trigger and header show placeholders.
export default function AccountMenu() {
  const { logout } = useAuth()
  const { me, isLoading } = useMe()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        title="Account menu"
        className="flex items-center gap-2 rounded-full p-0.5 text-sm text-foreground/80 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:rounded-md sm:pr-2"
      >
        <AccountAvatar me={me} />
        {me?.name && (
          <span className="hidden max-w-40 truncate sm:inline">{me.name}</span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 font-normal">
          <AccountAvatar me={me} className="size-10" />
          {me ? (
            <div className="min-w-0">
              <p className="truncate font-medium">{me.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {me.email}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? 'Loading your account…'
                : 'Account details unavailable'}
            </p>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <CircleUser aria-hidden />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing">
            <CreditCard aria-hidden />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
