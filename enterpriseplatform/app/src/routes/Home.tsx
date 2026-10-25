import { Link } from "react-router-dom";

export function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Training Studio</h1>
      <p className="text-slate-600">Build a training experience your people will actually practice.</p>
      <Link
        to="/create"
        className="rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
      >
        + Create Training
      </Link>
    </main>
  );
}
