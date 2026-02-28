import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0e1a]">
      <Link
        href="/constellations"
        className="rounded-full bg-[#ffd866] px-8 py-4 text-lg font-semibold text-[#0a0e1a] transition-transform hover:scale-105"
      >
        Enter Constellation Graph
      </Link>
    </div>
  );
}
