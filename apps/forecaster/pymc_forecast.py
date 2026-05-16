"""
PyMC Bayesian Hierarchical Model for IoT Temperature Forecasting
Uses hierarchical priors to model diurnal patterns with uncertainty quantification
"""

import os
import pandas as pd
import numpy as np
import pymc as pm
import psycopg2
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

def fetch_readings():
    """Fetch environmental readings from database"""
    conn = psycopg2.connect(DATABASE_URL)
    query = """
        SELECT id, "deviceId", temperature, humidity, pressure, "vocGas", "createdAt"
        FROM "EnvReading"
        ORDER BY "createdAt" ASC
    """
    df = pd.read_sql(query, conn)
    conn.close()
    print(f"✓ Fetched {len(df)} readings from database")
    return df

def prepare_data(df):
    """Prepare data for Bayesian modeling"""
    df['timestamp'] = pd.to_datetime(df['createdAt'])
    df['hour_of_day'] = df['timestamp'].dt.hour + df['timestamp'].dt.minute / 60.0
    df['time_numeric'] = (df['timestamp'] - df['timestamp'].min()).dt.total_seconds() / 3600.0
    
    # Normalize for better sampling
    df['temp_normalized'] = (df['temperature'] - df['temperature'].mean()) / df['temperature'].std()
    
    return df

def build_bayesian_model(df):
    """
    Build hierarchical Bayesian model:
    - Diurnal pattern (24-hour cycle via sine/cosine)
    - Linear trend
    - Observation noise
    - Hierarchical priors for uncertainty quantification
    """
    
    print("🔬 Building Bayesian hierarchical model...")
    
    with pm.Model() as model:
        # Data
        hour = df['hour_of_day'].values
        time = df['time_numeric'].values
        temp = df['temp_normalized'].values
        
        # Priors for diurnal pattern (sine/cosine components)
        # Using hierarchical priors for better uncertainty quantification
        amplitude = pm.HalfNormal('amplitude', sigma=2.0)
        phase = pm.Uniform('phase', lower=0, upper=24)
        
        # Prior for linear trend
        trend_slope = pm.Normal('trend_slope', mu=0, sigma=0.1)
        
        # Prior for baseline
        baseline = pm.Normal('baseline', mu=0, sigma=1.0)
        
        # Diurnal component (24-hour periodicity)
        diurnal = amplitude * pm.math.sin(2 * np.pi * (hour - phase) / 24.0)
        
        # Linear trend component
        trend = trend_slope * time
        
        # Expected temperature (deterministic)
        mu = baseline + diurnal + trend
        
        # Observation noise (hierarchical)
        sigma = pm.HalfNormal('sigma', sigma=0.5)
        
        # Likelihood
        y_obs = pm.Normal('y_obs', mu=mu, sigma=sigma, observed=temp)
        
    print("✓ Model built successfully")
    return model

def sample_posterior(model, draws=2000, tune=1000):
    """Sample from posterior distribution using NUTS"""
    print(f"⚡ Sampling posterior (draws={draws}, tune={tune})...")
    print("   This may take 2-5 minutes depending on data size...")
    
    with model:
        trace = pm.sample(
            draws=draws,
            tune=tune,
            chains=2,
            cores=2,
            return_inferencedata=True,
            progressbar=True
        )
    
    print("✓ Sampling complete")
    return trace

def generate_forecast(trace, df, forecast_hours=24):
    """Generate probabilistic forecast using posterior samples"""
    print(f"📊 Generating {forecast_hours}-hour Bayesian forecast...")
    
    # Get model parameters from trace
    amplitude_samples = trace.posterior['amplitude'].values.flatten()
    phase_samples = trace.posterior['phase'].values.flatten()
    trend_slope_samples = trace.posterior['trend_slope'].values.flatten()
    baseline_samples = trace.posterior['baseline'].values.flatten()
    sigma_samples = trace.posterior['sigma'].values.flatten()
    
    # Generate forecast timestamps (every 30 minutes)
    last_time = df['timestamp'].max()
    forecast_times = [last_time + timedelta(minutes=30*i) for i in range(1, int(forecast_hours * 2) + 1)]
    
    # Prepare forecast data
    forecast_df = pd.DataFrame({'timestamp': forecast_times})
    forecast_df['hour_of_day'] = forecast_df['timestamp'].dt.hour + forecast_df['timestamp'].dt.minute / 60.0
    forecast_df['time_numeric'] = (forecast_df['timestamp'] - df['timestamp'].min()).dt.total_seconds() / 3600.0
    
    # Sample forecasts from posterior predictive
    n_samples = len(amplitude_samples)
    predictions = np.zeros((n_samples, len(forecast_df)))
    
    for i in range(n_samples):
        diurnal = amplitude_samples[i] * np.sin(
            2 * np.pi * (forecast_df['hour_of_day'].values - phase_samples[i]) / 24.0
        )
        trend = trend_slope_samples[i] * forecast_df['time_numeric'].values
        mu = baseline_samples[i] + diurnal + trend
        
        # Add observation noise
        predictions[i, :] = np.random.normal(mu, sigma_samples[i])
    
    # Denormalize predictions
    temp_mean = df['temperature'].mean()
    temp_std = df['temperature'].std()
    predictions_denorm = predictions * temp_std + temp_mean
    
    # Calculate credible intervals
    forecast_df['predicted_temp'] = np.median(predictions_denorm, axis=0)
    forecast_df['lower_95'] = np.percentile(predictions_denorm, 2.5, axis=0)
    forecast_df['upper_95'] = np.percentile(predictions_denorm, 97.5, axis=0)
    forecast_df['lower_50'] = np.percentile(predictions_denorm, 25, axis=0)
    forecast_df['upper_50'] = np.percentile(predictions_denorm, 75, axis=0)
    
    print(f"✓ Generated {len(forecast_df)} forecast points")
    return forecast_df

def save_forecasts_to_db(forecast_df, model_name='pymc_bayesian'):
    """Save Bayesian forecasts to database"""
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # Clear existing forecasts for this model
    cursor.execute('DELETE FROM "Forecast" WHERE model = %s', (model_name,))
    
    # Insert new forecasts
    insert_count = 0
    for _, row in forecast_df.iterrows():
        cursor.execute("""
            INSERT INTO "Forecast" (
                "deviceId", timestamp, metric, "predictedValue",
                "lowerBound", "upperBound", model, "createdAt"
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            'dev:simulator-001',
            row['timestamp'],
            'temperature',
            float(row['predicted_temp']),
            float(row['lower_95']),
            float(row['upper_95']),
            model_name,
            datetime.now()
        ))
        insert_count += 1
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print(f"✓ Saved {insert_count} forecast records to database")

def main():
    print("=" * 70)
    print("PyMC Bayesian Hierarchical Forecasting - bayes-iot")
    print("=" * 70)
    
    # Step 1: Fetch data
    df = fetch_readings()
    
    if len(df) < 20:
        print("⚠️  Need at least 20 readings for Bayesian model. Run simulator first.")
        return
    
    # Step 2: Prepare data
    df = prepare_data(df)
    
    # Step 3: Build model
    model = build_bayesian_model(df)
    
    # Step 4: Sample posterior
    trace = sample_posterior(model, draws=2000, tune=1000)
    
    # Step 5: Generate forecast
    forecast = generate_forecast(trace, df, forecast_hours=24)
    
    # Step 6: Save to database
    save_forecasts_to_db(forecast, model_name='pymc_bayesian')
    
    print("\n" + "=" * 70)
    print("✓ Bayesian forecasting complete!")
    print("=" * 70)
    print(f"Next forecast: {forecast.iloc[0]['timestamp']}")
    print(f"Predicted temp: {forecast.iloc[0]['predicted_temp']:.2f}°C")
    print(f"95% CI: [{forecast.iloc[0]['lower_95']:.2f}, {forecast.iloc[0]['upper_95']:.2f}]")
    print(f"50% CI: [{forecast.iloc[0]['lower_50']:.2f}, {forecast.iloc[0]['upper_50']:.2f}]")
    print("\nKey advantage over Prophet: Full uncertainty quantification via MCMC")

if __name__ == "__main__":
    main()
