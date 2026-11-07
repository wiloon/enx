// What the 401 that ends an API request says about the session (#686). A 401
// on a request that carried a token is replayed once with a freshly minted
// Clerk token; the attempt that ends the request is classified here.

// How the request got its final 401: on a first attempt that had no token
// (so nothing was replayed), or on the forced replay, with or without a token.
export type FinalUnauthorizedReplay = 'none' | 'without-token' | 'with-token'

// 'lost': the session is gone (#236). 'unverified': Clerk minted a fresh
// token and enx-api still refused it, so Clerk holds the session and only
// this request failed; the account session is left alone.
export type FinalUnauthorized = 'lost' | 'unverified'

// A replay with no token stays a lost session until #688 tells a transient
// mint failure apart from Clerk holding no session.
export const classifyFinalUnauthorized = (
  replay: FinalUnauthorizedReplay
): FinalUnauthorized => (replay === 'with-token' ? 'unverified' : 'lost')
