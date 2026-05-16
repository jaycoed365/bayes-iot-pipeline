import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // Get the most recent forecast batch (all forecasts from latest forecastAt timestamp)
    const latestForecastTime = await prisma.forecast.findFirst({
      orderBy: { forecastAt: 'desc' },
      select: { forecastAt: true }
    });

    if (!latestForecastTime) {
      return NextResponse.json({ forecasts: [], forecastedAt: null });
    }

    // Get all forecasts from that batch
    const forecasts = await prisma.forecast.findMany({
      where: {
        forecastAt: latestForecastTime.forecastAt,
        modelName: 'prophet_baseline'
      },
      orderBy: { targetAt: 'asc' },
      select: {
        id: true,
        targetAt: true,
        tempC: true,
        tempCLower: true,
        tempCUpper: true,
        modelName: true,
        modelVersion: true,
        forecastAt: true
      }
    });

    return NextResponse.json({
      forecasts,
      forecastedAt: latestForecastTime.forecastAt,
      count: forecasts.length
    });
  } catch (error) {
    console.error('Error fetching forecasts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecasts' },
      { status: 500 }
    );
  }
}
