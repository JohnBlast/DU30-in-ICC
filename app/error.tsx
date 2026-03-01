"use client";

/**
 * Route segment error boundary. Catches errors in child segments.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h2 className="text-xl font-semibold text-gray-900">Something went wrong</h2>
      <p className="mt-2 text-gray-600">An error occurred. Please try again.</p>
      <button
        onClick={reset}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Try again
      </button>
    </div>
  );
}
