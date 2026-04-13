#!/usr/bin/env python3

import csv
import json
from collections import defaultdict
from pathlib import Path

RAW_FOREST = Path("13_Forest_and_Carbon.csv")
RAW_RISK = Path("15_Climate-driven_INFORM_Risk.csv")
RAW_EMISSIONS = Path(
    "03_National_Greenhouse_Gas_Emissions_Inventories_and_Implied_National_Mitigation_Nationally_Determined_Contributions_Targets.csv"
)


def year_columns(header):
    return sorted(
        [c for c in header if c.isdigit() and len(c) == 4],
        key=int,
    )


def parse_float(val):
    try:
        return float(val)
    except Exception:
        return None


def latest_value(row, year_cols):
    for year in reversed(year_cols):
        val = parse_float(row.get(year))
        if val is not None:
            return val, int(year)
    return None, None


def first_value(row, year_cols):
    for year in year_cols:
        val = parse_float(row.get(year))
        if val is not None:
            return val, int(year)
    return None, None


def load_forest():
    with RAW_FOREST.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        years = year_columns(reader.fieldnames)
        by_country = defaultdict(list)
        for row in reader:
            iso3 = row.get("ISO3", "").strip()
            if len(iso3) != 3:
                continue
            by_country[iso3].append(row)
    summary = {}
    for iso3, rows in by_country.items():
        entry = {"iso3": iso3, "country": rows[0].get("Country", "").strip()}
        # Carbon stock
        carbon_rows = [r for r in rows if r.get("Indicator") == "Carbon stocks in forests"]
        if carbon_rows:
            val, year = latest_value(carbon_rows[0], years)
            entry["carbon_stock"] = val
            entry["carbon_stock_year"] = year
        # Forest area change
        area_rows = [r for r in rows if r.get("Indicator") == "Forest area"]
        if area_rows:
            start_val, start_year = first_value(area_rows[0], years)
            latest_val, latest_year = latest_value(area_rows[0], years)
            entry["forest_area_latest"] = latest_val
            entry["forest_area_year"] = latest_year
            if start_val and latest_val and start_val > 0:
                entry["forest_change_pct"] = (latest_val - start_val) / start_val * 100.0
                entry["forest_change_years"] = [start_year, latest_year]
        # Forest extent index (optional for context)
        extent_rows = [r for r in rows if r.get("Indicator") == "Index of forest extent"]
        if extent_rows:
            val, year = latest_value(extent_rows[0], years)
            entry["forest_extent_index"] = val
            entry["forest_extent_year"] = year
        summary[iso3] = entry
    return summary


def load_risk():
    key_map = {
        "Climate-driven INFORM Risk Indicator": "risk",
        "Climate-driven Hazard & Exposure": "hazard",
        "Vulnerability": "vulnerability",
        "Lack of coping capacity": "coping_capacity",
    }
    with RAW_RISK.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        years = year_columns(reader.fieldnames)
        by_country = defaultdict(list)
        for row in reader:
            iso3 = row.get("ISO3", "").strip()
            if len(iso3) != 3:
                continue
            by_country[iso3].append(row)
    summary = {}
    targets = [
        "Climate-driven INFORM Risk Indicator",
        "Climate-driven Hazard & Exposure",
        "Vulnerability",
        "Lack of coping capacity",
    ]
    for iso3, rows in by_country.items():
        entry = {"iso3": iso3, "country": rows[0].get("Country", "").strip()}
        for target in targets:
            match = next((r for r in rows if r.get("Indicator") == target), None)
            if match:
                val, year = latest_value(match, years)
                key = key_map.get(target, target.lower().replace(" ", "_").replace("-", "_"))
                entry[key] = val
                entry[f"{key}_year"] = year
        summary[iso3] = entry
    return summary


def load_emissions():
    with RAW_EMISSIONS.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        years = year_columns(reader.fieldnames)
        data = {}
        for row in reader:
            iso3 = row.get("ISO3", "").strip()
            if len(iso3) != 3:
                continue
            if "Total GHG emissions including land-use" not in row.get("Indicator", ""):
                continue
            if row.get("Gas Type") != "Greenhouse gas":
                continue
            series = []
            for year in years:
                val = parse_float(row.get(year))
                if val is not None:
                    series.append({"year": int(year), "value": val})
            data[iso3] = {
                "iso3": iso3,
                "country": row.get("Country", "").strip(),
                "series": series,
            }
    return data


def merge_data(forest, risk, emissions):
    combined = {}
    keys = set(forest) | set(risk) | set(emissions)
    for iso3 in keys:
        entry = {"iso3": iso3}
        if iso3 in forest:
            entry.update(forest[iso3])
        if iso3 in risk:
            entry.update(risk[iso3])
        if iso3 in emissions:
            entry["has_emissions"] = True
        combined[iso3] = entry
    return combined


def main():
    forest = load_forest()
    risk = load_risk()
    emissions = load_emissions()
    combined = merge_data(forest, risk, emissions)
    # Keep only entries with at least a carbon stock or risk score
    country_summary = [
        v
        for v in combined.values()
        if v.get("carbon_stock") is not None or v.get("climate_driven_inform_risk_indicator") is not None
    ]
    Path("data").mkdir(exist_ok=True)
    with Path("data/country_summary.json").open("w", encoding="utf-8") as f:
        json.dump(country_summary, f, ensure_ascii=False, indent=2)
    with Path("data/emissions_timeseries.json").open("w", encoding="utf-8") as f:
        json.dump(emissions, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(country_summary)} countries to data/country_summary.json")
    print(f"Wrote {len(emissions)} countries to data/emissions_timeseries.json")


if __name__ == "__main__":
    main()
