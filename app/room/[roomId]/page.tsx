import { Suspense } from "react";
import Room from "@/components/Room";

interface PageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ myLang?: string; targetLang?: string; role?: string }>;
}

export default async function RoomPage({ params, searchParams }: PageProps) {
  const { roomId } = await params;
  const { myLang = "hi", targetLang = "en", role = "callee" } = await searchParams;

  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">Loading...</div>}>
      <Room
        roomId={roomId.toUpperCase()}
        myLangCode={myLang}
        targetLangCode={targetLang}
        role={role as "caller" | "callee"}
      />
    </Suspense>
  );
}