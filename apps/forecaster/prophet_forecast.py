"""
Prophet Baseline Forecasting for bayes-iot
Generates 24-hour temperature forecasts with confidence intervals
"""

import os
import pandas as pd
import psycopg2
from prophet import Prophet
from datetime import datetime, timedelta
from dotenv import load_dotenv
import uuid

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
# Train only on the real Swan/Notecard (not the simulator or test rows),
# and only on recent data so the months-long gap before Oct/Nov doesn't skew the trend.
DEVICE_UID = os.getenv("DEVICE_UID", "dev:351077454469720")
LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", "7"))

def fetch_readings():
    """Fetch all environmental readings from Neon Postgres"""
    conn = psycopg2.connect(DATABASE_URL)
    
    query = """
        SELECT id, "deviceUid", "tempC", humidity, "pressureHpa", "vocOhms", "capturedAt"
        FROM "EnvReading"
        WHERE "deviceUid" = %(device)s
          AND "capturedAt" >= NOW() - (%(days)s * INTERVAL '1 day')
        ORDER BY "capturedAt" ASC
    """
    
    df = pd.read_sql(query, conn, params={"device": DEVICE_UID, "days": LOOKBACK_DAYS})
    conn.close()

    # Rename columns to match expected format
    df = df.rename(columns={
        'deviceUid': 'deviceId',
        'tempC': 'temperature',
        'pressureHpa': 'pressure',
        'vocOhms': 'vocGas',
        'capturedAt': 'createdAt'
    })
    
    print(f"✓ Fetched {len(df)} readings for {DEVICE_UID} (last {LOOKBACK_DAYS} days)")
    return df

def prepare_prophet_data(df, column='temperature'):
    """Convert to Prophet format: ds (datetime), y (value)"""
    prophet_df = pd.DataFrame({
        'ds': pd.to_datetime(df['createdAt']),
        'y': df[column]
    })
    
    # Remove any nulls
    prophet_df = prophet_df.dropna()
    
    print(f"✓ Prepared {len(prophet_df)} data points for Prophet")
    return prophet_df

def train_prophet_model(df):
    """Train Prophet model on temperature data"""
    print("⚡ Training Prophet model...")
    
    model = Prophet(
        interval_width=0.95,  # 95% confidence intervals
        daily_seasonality=True,
        weekly_seasonality=False,  # Not enough data yet
        yearly_seasonality=False   # Not enough data yet
    )
    
    model.fit(df)
    print("✓ Model trained successfully")
    
    return model

def generate_forecast(model, periods=48):
    """Generate forecast for next N periods (30-min intervals = 24 hours)"""
    future = model.make_future_dataframe(periods=periods, freq='30min')
    forecast = model.predict(future)
    
    # Only return future predictions (not historical fit)
    forecast_future = forecast.tail(periods)
    
    print(f"✓ Generated {len(forecast_future)} forecast points (next 24 hours)")
    return forecast_future

def save_forecasts_to_db(forecast_df, model_name='prophet_baseline'):
    """Save forecast predictions to Forecast table"""
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # Clear existing forecasts for this model
    cursor.execute('DELETE FROM "Forecast" WHERE "modelName" = %s', (model_name,))
    
    # Insert new forecasts
    insert_count = 0
    forecast_made_at = datetime.now()
    model_version = '1.3.0'  # Prophet version we installed
    
    for _, row in forecast_df.iterrows():
        # Generate a unique ID (cuid-style)
        forecast_id = f"fc_{uuid.uuid4().hex[:24]}"
        
        cursor.execute("""
            INSERT INTO "Forecast" (
                id, "deviceUid", "modelName", "modelVersion", 
                "forecastAt", "targetAt", "tempC", "tempCLower", "tempCUpper"
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            forecast_id,           # unique ID
            DEVICE_UID,            # device identifier
            model_name,            # 'prophet_baseline'
            model_version,         # '1.3.0'
            forecast_made_at,      # when we made this forecast
            row['ds'],             # the future time we're predicting
            float(row['yhat']),    # predicted temperature
            float(row['yhat_lower']),  # 95% CI lower
            float(row['yhat_upper'])   # 95% CI upper
        ))
        insert_count += 1
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print(f"✓ Saved {insert_count} forecast records to database")

def main():
    print("=" * 60)
    print("Prophet Baseline Forecasting - bayes-iot")
    print("=" * 60)
    
    # Step 1: Fetch historical data
    readings_df = fetch_readings()
    
    if len(readings_df) < 10:
        print("⚠️  Need at least 10 readings to train model. Run simulator first.")
        return
    
    # Step 2: Prepare data for Prophet
    prophet_data = prepare_prophet_data(readings_df, column='temperature')
    
    # Step 3: Train model
    model = train_prophet_model(prophet_data)
    
    # Step 4: Generate 24-hour forecast
    forecast = generate_forecast(model, periods=48)  # 48 × 30min = 24 hours
    
    # Step 5: Save to database
    save_forecasts_to_db(forecast, model_name='prophet_baseline')
    
    print("\n" + "=" * 60)
    print("✓ Forecasting complete!")
    print("=" * 60)
    print(f"Next forecast point: {forecast.iloc[0]['ds']}")
    print(f"Predicted temp: {forecast.iloc[0]['yhat']:.2f}°C")
    print(f"95% CI: [{forecast.iloc[0]['yhat_lower']:.2f}, {forecast.iloc[0]['yhat_upper']:.2f}]")
    print("\nRun this script periodically (e.g., every hour) to refresh forecasts.")

if __name__ == "__main__":
    main()
