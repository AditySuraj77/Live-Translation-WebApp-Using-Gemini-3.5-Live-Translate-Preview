import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getCountryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export async function GET(req: NextRequest) {
  // 1. Check for standard edge deployment headers (Vercel, Cloudflare, etc.)
  const vercelCity = req.headers.get("x-vercel-ip-city");
  const vercelCountry = req.headers.get("x-vercel-ip-country") || "IN";
  const vercelLat = req.headers.get("x-vercel-ip-latitude");
  const vercelLon = req.headers.get("x-vercel-ip-longitude");

  if (vercelCity && vercelLat && vercelLon) {
    return NextResponse.json({
      city: decodeURIComponent(vercelCity),
      country: req.headers.get("x-vercel-ip-country-region") || vercelCountry,
      countryCode: vercelCountry,
      flag: getCountryFlag(vercelCountry),
      lat: parseFloat(vercelLat),
      lon: parseFloat(vercelLon),
    });
  }

  // 2. Extract Client IP
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const rawIp = forwarded ? forwarded.split(",")[0].trim() : realIp || "127.0.0.1";

  // Check query simulation for local multi-tab testing
  const url = new URL(req.url);
  const sim = url.searchParams.get("sim");

  const isLocal =
    rawIp === "127.0.0.1" ||
    rawIp === "::1" ||
    rawIp.startsWith("192.168.") ||
    rawIp.startsWith("10.") ||
    rawIp === "localhost";

  if (isLocal) {
    if (sim === "peer") {
      return NextResponse.json({
        city: "Madrid",
        country: "Spain",
        countryCode: "ES",
        flag: "🇪🇸",
        lat: 40.4168,
        lon: -3.7038,
      });
    }
    return NextResponse.json({
      city: "Mumbai",
      country: "India",
      countryCode: "IN",
      flag: "🇮🇳",
      lat: 19.076,
      lon: 72.8777,
    });
  }

  // 3. Fallback to free, fast IP geolocation for non-edge servers
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`https://ipapi.co/${rawIp}/json/`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.city && data.latitude && data.longitude) {
        return NextResponse.json({
          city: data.city,
          country: data.country_name || data.country,
          countryCode: data.country_code || data.country,
          flag: getCountryFlag(data.country_code || data.country),
          lat: data.latitude,
          lon: data.longitude,
        });
      }
    }
  } catch (e) {
    console.warn("[Location API] IP geolocation lookup fallback:", e);
  }

  // Default fallback
  return NextResponse.json({
    city: "Mumbai",
    country: "India",
    countryCode: "IN",
    flag: "🇮🇳",
    lat: 19.076,
    lon: 72.8777,
  });
}
