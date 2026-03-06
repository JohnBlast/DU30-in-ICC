"use client";

/**
 * Login page — username + password form.
 * PRD §4 (Auth), Task 7.1.
 * Styled with Primer design system.
 */

import { useState, useEffect } from "react";
import { Button, FormControl, TextInput } from "@primer/react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("signed_out") === "1") {
      setSignedOut(true);
      window.history.replaceState(null, "", "/login");
    } else if (window.location.search === "?") {
      window.history.replaceState(null, "", "/login");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "same-origin",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Login failed");
        setLoading(false);
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Login failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
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

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <FormControl id="username" required>
            <FormControl.Label>Username</FormControl.Label>
            <TextInput
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
              block
            />
          </FormControl>

          <FormControl id="password" required>
            <FormControl.Label>Password</FormControl.Label>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
