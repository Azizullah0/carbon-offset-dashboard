## Carbon offset dashboard

## How to run
This is a static D3 dashboard. Start a local server in this folder and open the page:
```
python3 -m http.server 8000
```
Then visit `http://localhost:8000/` in a browser.

## Files
- `index.html`, `style.css`, `main.js`: Dashboard implementation.
- `data/country_summary.json`: Preprocessed country metrics (carbon, forest change, risk).
- `data/emissions_timeseries.json`: Emissions time series per country.
- `data/world-110m.json`: World topojson for the map.
- `prep_data.py`: Script used to generate the JSONs from the raw CSVs.

## Data sources
- `13_Forest_and_Carbon.csv`
- `15_Climate-driven_INFORM_Risk.csv`
- `03_National_Greenhouse_Gas_Emissions_Inventories_and_Implied_National_Mitigation_Nationally_Determined_Contributions_Targets.csv`

## Report
A5_Report.pdf
