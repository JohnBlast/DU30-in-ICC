"use client";

/**
 * Login page — username + password form.
 * PRD §4 (Auth), Task 7.1.
 * Styled with Primer design system.
 * Uses native form POST so server returns 303 redirect with cookie; no client-side redirect.
 */

import { useState, useEffect } from "react";
import { Button, FormControl, TextInput } from "@primer/react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("signed_out") === "1") {
      setSignedOut(true);
      window.history.replaceState(null, "", "/login");
    } else {
      const err = params.get("error");
      if (err) {
        setError(decodeURIComponent(err));
        window.history.replaceState(null, "", "/login");
      } else if (window.location.search === "?") {
        window.history.replaceState(null, "", "/login");
      }
    }
  }, []);

  function handleSubmit() {
    setLoading(true);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">The Docket</h1>
        <p className="mt-1 text-sm text-gray-600">ICC Philippines Case Q&A</p>

        {signedOut && (
          <div className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
            You have been signed out.
          </div>
        )}
        <div className="mt-4 rounded bg-gray-50 px-3 py-2 text-xs text-gray-600" role="note">
          <strong className="text-gray-700">Data privacy:</strong> We store only your username and
          hashed password. Conversations auto-delete after 7 days. Your data is not used for
          training or shared with third parties.
        </div>

        <form
          action="/api/auth/login"
          method="POST"
          onSubmit={handleSubmit}
          className="mt-6 space-y-4"
        >
          <FormControl id="username" required>
            <FormControl.Label>Username</FormControl.Label>
            <TextInput
              name="username"
              type="text"
              autoComplete="username"
              disabled={loading}
              block
            />
          </FormControl>

          <FormControl id="password" required>
            <FormControl.Label>Password</FormControl.Label>
            <TextInput
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={loading}
              block
            />
          </FormControl>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={loading} block>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
