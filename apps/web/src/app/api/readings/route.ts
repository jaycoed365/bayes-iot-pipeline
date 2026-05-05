// GET /api/readings?limit=50&device=dev:simulator-001
// Returns latest readings as JSON for the dashboard to poll.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Don't cache - we want fresh data on every poll
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 500);
  const device = searchParams.get("device");

  const where = device ? { deviceUid: device } : {};

  const readings = await prisma.envReading.findMany({
    where,
    orderBy: { capturedAt: "desc" },
    take: limit,
    select: {
      id: true,
      deviceUid: true,
      capturedAt: true,
      tempC: true,
      humidity: true,
      pressureHpa: true,
      vocOhms: true,
    },
  });

  // Return in chronological order (oldest first) for charts
  const chronological = readings.reverse();

  return NextResponse.json({
    count: chronological.length,
    readings: chronological,
    generatedAt: new Date().toISOString(),
  });
}
