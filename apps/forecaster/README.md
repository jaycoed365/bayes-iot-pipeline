# Forecasting Service: Prophet + PyMC Bayesian

Two forecasting approaches for temperature prediction:
1. **Prophet** - Facebook's time-series forecasting (baseline, fast)
2. **PyMC** - Bayesian hierarchical model (advanced, probabilistic)

## Quick Start

### 1. Install Dependencies

```bash
cd apps/forecaster
pip install -r requirements.txt --break-system-packages
```

**Note:** PyMC installation takes 3-5 minutes (includes JAX, Aesara dependencies).

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your DATABASE_URL from Neon
```

### 3. Run Forecasting

**Option A: Prophet Baseline (Fast - 30 seconds)**
```bash
python prophet_forecast.py
```

**Option B: PyMC Bayesian (Slow - 3-5 minutes)**
```bash
python pymc_forecast.py
```

## Prophet vs. PyMC

| Aspect | Prophet | PyMC Bayesian |
|--------|---------|---------------|
| Speed | 30 seconds | 3-5 minutes |
| Method | Additive model | MCMC sampling |
| Uncertainty | Frequentist CIs | Bayesian credible intervals |
| Interpretability | High | Medium |
| Resume Value | Good | **Excellent** |

## Output

Both scripts write to the `Forecast` table with:
- `predictedValue`: Point estimate
- `lowerBound`: 95% CI/credible interval lower
- `upperBound`: 95% CI/credible interval upper
- `model`: 'prophet_baseline' or 'pymc_bayesian'

## Next Steps

1. Run both models to populate forecasts
2. Update dashboard to query `Forecast` table
3. Display forecast overlay on temperature chart with confidence bands
4. Add model comparison panel (Prophet vs PyMC accuracy)

## For Your Resume

**Prophet:** Shows you can use industry-standard tools
**PyMC:** Shows you understand Bayesian inference, MCMC, hierarchical modeling — this is what gets you hired for quant/ML roles

