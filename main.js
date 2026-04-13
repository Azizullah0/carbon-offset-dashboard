// Main dashboard script

const WIDTH = 900;
const HEIGHT = 360;
const margin = { top: 16, right: 18, bottom: 32, left: 50 };

const selected = new Set();
let filtered = [];
let data = [];
let emissions = {};
let countryByIso = new Map();
let isoByNameNorm = new Map();
let carbonLatestYear = null;
let riskLatestYear = null;
let timelineScale = "selected";

const tooltip = d3.select("body").append("div").attr("class", "tooltip");

const norm = (str) =>
  str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const overrides = new Map([
  ["unitedstatesofamerica", "USA"],
  ["unitedstates", "USA"],
  ["russia", "RUS"],
  ["russianfederation", "RUS"],
  ["dem.rep.congo", "COD"],
  ["democraticrepublicofthecongo", "COD"],
  ["congo", "COG"],
  ["cotedivoire", "CIV"],
  ["ivorycoast", "CIV"],
  ["kyrgyzrepublic", "KGZ"],
  ["lao", "LAO"],
  ["laos", "LAO"],
  ["viet nam", "VNM"],
  ["myanmar", "MMR"],
  ["czechia", "CZE"],
  ["bolivia", "BOL"],
  ["venezuela", "VEN"],
  ["britishindianoceanterritory", "IOT"],
  ["hongkong", "HKG"],
]);

async function loadData() {
  const [summary, timeseries, world] = await Promise.all([
    d3.json("data/country_summary.json"),
    d3.json("data/emissions_timeseries.json"),
    d3.json("data/world-110m.json"),
  ]);

  data = summary;
  emissions = timeseries;

  data.forEach((d) => {
    countryByIso.set(d.iso3, d.country);
    isoByNameNorm.set(norm(d.country), d.iso3);
    if (d.carbon_stock_year) {
      carbonLatestYear = carbonLatestYear ? Math.max(carbonLatestYear, d.carbon_stock_year) : d.carbon_stock_year;
    }
    if (d.risk_year) {
      riskLatestYear = riskLatestYear ? Math.max(riskLatestYear, d.risk_year) : d.risk_year;
    }
  });

  const countries = topojson.feature(world, world.objects.countries).features;
  countries.forEach((f) => {
    const nameKey = norm(f.properties.name);
    f.iso3 = overrides.get(nameKey) || isoByNameNorm.get(nameKey);
  });

  initVis(countries);
}

function initVis(countries) {
  filtered = data.slice();
  const [minCarbon, maxCarbon] = carbonExtent();
  colorCarbon = d3
    .scaleSequentialLog(d3.interpolateYlGn)
    .domain([minCarbon, maxCarbon])
    .clamp(true);
  setYearNotes();
  renderMap(countries);
  renderScatter();
  renderParallel();
  renderTimeline();
  buildLegend();
  initSearch();
  d3.select("#clear-selection").on("click", clearSelection);
  updateChips();
  initTimelineToggle();
}

function carbonExtent() {
  const vals = data.map((d) => d.carbon_stock).filter((d) => d != null && d > 0);
  const extent = d3.extent(vals);
  return [extent[0] || 1, extent[1] || 1];
}

function riskExtent() {
  return [0, d3.max(data, (d) => d.hazard || 0) || 10];
}

let colorCarbon = null;
const colorRisk = d3.scaleLinear().domain([0, 10]).range(["#22c55e", "#f43f5e"]);
const catColor = d3.scaleOrdinal(d3.schemeTableau10);

function renderMap(countries) {
  const svg = d3
    .select("#map")
    .attr("viewBox", [0, 0, WIDTH, HEIGHT])
    .attr("preserveAspectRatio", "xMidYMid meet");

  const projection = d3
    .geoNaturalEarth1()
    .fitSize([WIDTH, HEIGHT], { type: "FeatureCollection", features: countries });
  const path = d3.geoPath(projection);

  const countriesGroup = svg.append("g").attr("class", "countries");

  countriesGroup
    .selectAll("path")
    .data(countries)
    .join("path")
    .attr("d", path)
    .attr("fill", (d) => {
      const entry = data.find((c) => c.iso3 === d.iso3);
      return entry && entry.carbon_stock ? colorCarbon(entry.carbon_stock) : "#cbd5e1";
    })
    .attr("stroke", "#94a3b8")
    .attr("stroke-width", 0.5)
    .on("click", (event, d) => toggleSelect(d.iso3))
    .on("mousemove", (event, d) => {
      const entry = data.find((c) => c.iso3 === d.iso3);
      if (!entry) {
        showTooltip(event, `${d.properties.name}<br/>No data`);
        return;
      }
      showTooltip(
        event,
        `${entry.country}<br/>Carbon stock: ${fmt(entry.carbon_stock)} Mt (year ${entry.carbon_stock_year || "n/a"})`
      );
    })
    .on("mouseleave", hideTooltip);
}

function renderScatter() {
  const scatterData = data.filter((d) => d.carbon_stock && d.hazard != null);
  const svg = d3
    .select("#scatter")
    .attr("viewBox", [0, 0, WIDTH, HEIGHT])
    .attr("preserveAspectRatio", "xMidYMid meet");

  const localMargin = { top: 24, right: margin.right, bottom: margin.bottom, left: 62 };
  const inner = svg
    .append("g")
    .attr("transform", `translate(${localMargin.left},${localMargin.top})`);

  const w = WIDTH - localMargin.left - localMargin.right;
  const h = HEIGHT - localMargin.top - localMargin.bottom;

  const x = d3.scaleLinear().domain([0, 10]).range([0, w]);
  const y = d3
    .scaleLog()
    .domain([Math.max(1, carbonExtent()[0] || 1), carbonExtent()[1] || 1e5])
    .range([h, 0]);
  const r = d3
    .scaleSqrt()
    .domain(d3.extent(scatterData, (d) => d.forest_area_latest || 0))
    .range([3, 16]);

  inner
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(6))
    .append("text")
    .attr("x", w)
    .attr("y", 32)
    .attr("fill", "#cbd5e1")
    .attr("text-anchor", "end")
    .text("Climate hazard (0-10)");

  inner
    .append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(6, "~s"))
    .append("text")
    .attr("x", 0)
    .attr("y", -12)
    .attr("fill", "#cbd5e1")
    .attr("text-anchor", "start")
    .text("Carbon stock (Mt, log)");

  inner
    .append("g")
    .attr("class", "grid")
    .selectAll("line")
    .data(x.ticks(6))
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", (d) => x(d))
    .attr("x2", (d) => x(d))
    .attr("y1", 0)
    .attr("y2", h);

  const pts = inner
    .append("g")
    .attr("class", "points")
    .selectAll("circle")
    .data(scatterData)
    .join("circle")
    .attr("cx", (d) => x(d.hazard || 0))
    .attr("cy", (d) => y(d.carbon_stock || 1))
    .attr("r", (d) => r(d.forest_area_latest || 0))
    .attr("fill", (d) => colorRisk(d.risk || 0))
    .attr("fill-opacity", 0.8)
    .attr("stroke", "#ffffff")
    .on("click", (event, d) => toggleSelect(d.iso3))
    .on("mousemove", (event, d) => {
      showTooltip(
        event,
        `${d.country}<br/>Carbon: ${fmt(d.carbon_stock)} Mt (year ${d.carbon_stock_year || "n/a"})<br/>Hazard: ${
          d.hazard ?? "n/a"
        }<br/>Risk: ${d.risk ?? "n/a"}<br/>Forest area: ${fmt(d.forest_area_latest)} km²`
      );
    })
    .on("mouseleave", hideTooltip);

  updateMarks(() => pts, "scatter");

  // Legends: risk color bar and size bubbles
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "riskGrad");
  grad
    .selectAll("stop")
    .data([
      { offset: "0%", color: colorRisk(0) },
      { offset: "50%", color: colorRisk(5) },
      { offset: "100%", color: colorRisk(10) },
    ])
    .join("stop")
    .attr("offset", (d) => d.offset)
    .attr("stop-color", (d) => d.color);

  const legend = inner.append("g").attr("transform", `translate(${w - 220},${8})`);
  legend
    .append("rect")
    .attr("x", -8)
    .attr("y", -6)
    .attr("width", 200)
    .attr("height", 54)
    .attr("rx", 6)
    .attr("fill", "#ffffff")
    .attr("stroke", "#e5e7eb");
  legend
    .append("text")
    .attr("fill", "#1f2933")
    .attr("font-size", 12)
    .attr("font-weight", 600)
    .text("Risk (color)");
  legend
    .append("rect")
    .attr("y", 12)
    .attr("width", 170)
    .attr("height", 10)
    .attr("fill", "url(#riskGrad)")
    .attr("stroke", "#cbd5e1");
  legend
    .append("text")
    .attr("fill", "#4b5563")
    .attr("font-size", 11)
    .attr("y", 34)
    .text("0          5          10");

  const sizeLegend = inner.append("g").attr("transform", `translate(${w - 220},${70})`);
  sizeLegend
    .append("rect")
    .attr("x", -8)
    .attr("y", -6)
    .attr("width", 200)
    .attr("height", 70)
    .attr("rx", 6)
    .attr("fill", "#ffffff")
    .attr("stroke", "#e5e7eb");
  sizeLegend
    .append("text")
    .attr("fill", "#1f2933")
    .attr("font-size", 12)
    .attr("font-weight", 600)
    .text("Forest area (size)");

  const sizes = [r.domain()[0], (r.domain()[0] + r.domain()[1]) / 2, r.domain()[1]];
  sizeLegend
    .selectAll("circle")
    .data(sizes)
    .join("circle")
    .attr("cx", (d, i) => 15 + i * 45)
    .attr("cy", 28)
    .attr("r", (d) => r(d))
    .attr("fill", "#22c55e")
    .attr("fill-opacity", 0.6)
    .attr("stroke", "#0f172a");
  sizeLegend
    .selectAll("text.size")
    .data(sizes)
    .join("text")
    .attr("class", "size")
    .attr("x", (d, i) => 15 + i * 45)
    .attr("y", 52)
    .attr("text-anchor", "middle")
    .attr("fill", "#4b5563")
    .attr("font-size", 11)
    .text((d) => fmt(d));
}

function renderParallel() {
  const svg = d3
    .select("#parallel")
    .attr("viewBox", [0, 0, WIDTH, 360])
    .attr("preserveAspectRatio", "xMidYMid meet");

  const localMargin = { top: 26, right: margin.right, bottom: 20, left: margin.left };
  const w = WIDTH - localMargin.left - localMargin.right;
  const h = 320 - (localMargin.top - margin.top);
  const inner = svg.append("g").attr("transform", `translate(${localMargin.left},${localMargin.top})`);

  const dims = [
    { key: "carbon_stock", label: "Carbon (norm)", scale: d3.scaleLinear().domain([0, 1]) },
    { key: "forest_change_pct", label: "Forest change % (norm)", scale: d3.scaleLinear().domain([0, 1]) },
    { key: "hazard", label: "Hazard (norm)", scale: d3.scaleLinear().domain([0, 1]) },
    { key: "risk", label: "Risk (norm)", scale: d3.scaleLinear().domain([0, 1]) },
    { key: "vulnerability", label: "Vulnerability (norm)", scale: d3.scaleLinear().domain([0, 1]) },
    { key: "coping_capacity", label: "Coping capacity (norm)", scale: d3.scaleLinear().domain([0, 1]) },
  ];

  const parallelData = data.filter((d) =>
    dims.every((dim) => d[dim.key] != null && (dim.key !== "carbon_stock" || d[dim.key] > 0))
  );

  const normStats = {};
  dims.forEach((d) => {
    const vals = parallelData.map((p) => p[d.key]).filter((v) => v != null);
    const extent = d3.extent(vals);
    normStats[d.key] = extent;
    d.scale.range([h, 0]);
  });

  const x = d3
    .scalePoint()
    .domain(dims.map((d) => d.key))
    .range([0, w])
    .padding(0.5);

  const normalize = (key, val) => {
    if (val == null) return null;
    const [min, max] = normStats[key];
    if (min == null || max == null || max === min) return 0.5;
    return (val - min) / (max - min);
  };

  const line = d3
    .line()
    .defined(([, v]) => v != null)
    .x(([key]) => x(key))
    .y(([key, val]) => dims.find((d) => d.key === key).scale(val));

  const group = inner.append("g").attr("class", "p-lines");

  const paths = group
    .selectAll("path")
    .data(parallelData)
    .join("path")
    .attr("fill", "none")
    .attr("stroke", (d) => catColor(d.iso3))
    .attr("stroke-opacity", 0.22)
    .attr("stroke-width", 1.2)
    .attr("d", (d) =>
      line(
        dims.map((dim) => [dim.key, normalize(dim.key, d[dim.key])])
      )
    );

  const axisGroup = inner.append("g").attr("class", "axes");

  dims.forEach((dim) => {
    const g = axisGroup
      .append("g")
      .attr("transform", `translate(${x(dim.key)},0)`)
      .attr("class", "axis");
    g.call(d3.axisLeft(dim.scale).ticks(5).tickFormat(d3.format(".1f")));
    g.append("text")
      .attr("fill", "#cbd5e1")
      .attr("y", -6)
      .attr("text-anchor", "middle")
      .text(dim.label);

    const brush = d3
      .brushY()
      .extent([
        [-12, 0],
        [12, h],
      ])
      .on("brush end", ({ selection }) => {
        if (!selection) {
          dim.brush = null;
        } else {
          const [y0, y1] = selection;
          const v0 = dim.scale.invert(y0);
          const v1 = dim.scale.invert(y1);
          dim.brush = [Math.min(v0, v1), Math.max(v0, v1)];
        }
        applyFilters(paths);
      });

    g.append("g").attr("class", "brush").call(brush);
  });

  function applyFilters(pathsSel) {
    const activeDims = dims.filter((d) => d.brush);
    filtered = parallelData.filter((d) =>
      activeDims.every((dim) => {
        const [lo, hi] = dim.brush;
        const val = normalize(dim.key, d[dim.key]);
        return val != null && val >= lo && val <= hi;
      })
    );
    pathsSel.classed("faded", (d) => !filtered.includes(d));
    updateMarks();
    const badge = d3.select("#filter-status");
    if (activeDims.length === 0) {
      badge.text("No filters");
    } else {
      badge.text(`Filters: ${activeDims.length}`);
    }
  }

  updateMarks(() => paths, "parallel");
}

function renderTimeline() {
  const svg = d3
    .select("#timeline")
    .attr("viewBox", [0, 0, WIDTH, 360])
    .attr("preserveAspectRatio", "xMidYMid meet");
  const inner = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const w = WIDTH - margin.left - margin.right;
  const h = 320;

  const years = new Set();
  Object.values(emissions).forEach((c) => c.series.forEach((p) => years.add(p.year)));
  const x = d3.scaleLinear().domain(d3.extent([...years])).range([0, w]);

  const globalMax =
    d3.max(Object.values(emissions), (c) => d3.max(c.series, (p) => p.value) || 0) || 1;
  const y = d3.scaleLinear().domain([0, globalMax]).nice().range([h, 0]);

  inner.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(8, "d"));
  const yAxisG = inner.append("g").attr("class", "axis y").call(d3.axisLeft(y).ticks(6, "~s"));

  inner
    .append("text")
    .attr("x", w)
    .attr("y", h + 32)
    .attr("text-anchor", "end")
    .attr("fill", "#cbd5e1")
    .text("Year");

  inner
    .append("text")
    .attr("x", 0)
    .attr("y", -6)
    .attr("text-anchor", "start")
    .attr("fill", "#1f2933")
    .attr("font-size", 13)
    .attr("font-weight", 600)
    .text("GHG emissions (Mt CO₂e)");

  const line = d3
    .line()
    .x((d) => x(d.year))
    .y((d) => y(d.value));

  const lines = inner.append("g").attr("class", "t-lines");

  // grid lines
  const gridG = inner
    .append("g")
    .attr("class", "grid")
    .selectAll("line")
    .data(y.ticks(6))
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", 0)
    .attr("x2", w)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d));

  function update() {
    const chosen = [...selected].slice(0, 5);
    d3.select("#timeline-empty").style("display", chosen.length ? "none" : "block");
    const series = chosen
      .map((iso) => emissions[iso])
      .filter(Boolean)
      .map((c) => ({ iso: c.iso3, country: c.country, series: c.series }));

    const localMax =
      d3.max(series, (c) => d3.max(c.series, (p) => p.value) || 0) || 1;
    const yMax = timelineScale === "selected" && series.length ? localMax : globalMax;
    y.domain([0, yMax]).nice();
    yAxisG.call(d3.axisLeft(y).ticks(6, "~s"));
    gridG
      .selectAll("line")
      .data(y.ticks(6))
      .join("line")
      .attr("class", "grid-line")
      .attr("x1", 0)
      .attr("x2", w)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d));

    const l = lines.selectAll("path").data(series, (d) => d.iso);
    l.join(
      (enter) =>
        enter
          .append("path")
          .attr("fill", "none")
          .attr("stroke-width", 2.2)
          .attr("stroke", (d) => catColor(d.iso))
          .attr("d", (d) => line(d.series))
          .attr("opacity", 0.2)
          .call((p) => p.transition().duration(400).attr("opacity", 1)),
      (update) => update,
      (exit) => exit.transition().duration(200).attr("opacity", 0).remove()
    )
      .on("mousemove", (event, d) => {
        const last = d.series[d.series.length - 1];
        showTooltip(event, `${d.country}<br/>Last: ${fmt(last?.value)} Mt in ${last?.year}`);
      })
      .on("mouseleave", hideTooltip);
  }

  renderTimeline.update = update;
  update();
}

function initTimelineToggle() {
  d3.selectAll(".toggle-btn").on("click", function () {
    const mode = this.getAttribute("data-scale");
    timelineScale = mode;
    d3.selectAll(".toggle-btn").classed("active", false);
    d3.select(this).classed("active", true);
    renderTimeline.update();
  });
}

function buildLegend() {
  const legend = d3.select("#map-legend");
  legend.html("");
  legend.append("div").attr("class", "bar");
  const [min, max] = carbonExtent();
  legend
    .append("div")
    .text(`${fmt(min)} Mt`)
    .style("color", "#4b5563");
  legend
    .append("div")
    .text(`${fmt(max)} Mt`)
    .style("color", "#4b5563");
  legend.append("div").attr("class", "pill").text("No data = gray");
}

function initSearch() {
  const input = d3.select("#country-search");
  input.on("input", () => {
    const q = norm(input.property("value"));
    if (!q) {
      updateMarks();
      return;
    }
    const matches = data.filter((d) => norm(d.country).includes(q));
    const isoSet = new Set(matches.map((d) => d.iso3));
    d3.selectAll("circle").classed("faded", (d) => !isoSet.has(d.iso3));
    d3.select("#map .countries")
      .selectAll("path")
      .classed("selected", (d) => isoSet.has(d.iso3) || selected.has(d.iso3));
  });
}

function toggleSelect(iso3) {
  if (!iso3) return;
  if (selected.has(iso3)) {
    selected.delete(iso3);
  } else {
    if (selected.size >= 5) return;
    selected.add(iso3);
  }
  updateMarks();
  renderTimeline.update();
   updateChips();
}

function clearSelection() {
  selected.clear();
  updateMarks();
  renderTimeline.update();
  updateChips();
}

function updateMarks(getSel, source) {
  const filteredSet = new Set(filtered.map((d) => d.iso3));
  const selectedSet = new Set(selected);

  const apply = (sel) => {
    sel.classed("faded", (d) => !filteredSet.has(d.iso3));
    sel.classed("selected", (d) => selectedSet.has(d.iso3));
  };

  if (getSel) apply(getSel());
  d3.select("#map .countries")
    .selectAll("path")
    .classed("faded", (d) => !filteredSet.has(d.iso3))
    .classed("selected", (d) => selectedSet.has(d.iso3));
  d3.select("#scatter .points")
    .selectAll("circle")
    .classed("faded", (d) => !filteredSet.has(d.iso3))
    .classed("selected", (d) => selectedSet.has(d.iso3));
  d3.select("#parallel .p-lines")
    .selectAll("path")
    .classed("faded", (d) => !filteredSet.has(d.iso3))
    .classed("selected", (d) => selectedSet.has(d.iso3));
}

function fmt(val) {
  return val == null ? "n/a" : d3.format(".2s")(val).replace("G", "B");
}

function setYearNotes() {
  const note = [];
  if (carbonLatestYear) note.push(`carbon: ${carbonLatestYear}`);
  if (riskLatestYear) note.push(`risk: ${riskLatestYear}`);
  d3.select("#year-notes").text(note.length ? `(latest data years – ${note.join(", ")})` : "");
}

function updateChips() {
  const chips = d3.select("#selection-chips");
  const arr = [...selected];
  const sel = chips.selectAll(".chip").data(arr, (d) => d);
  const enter = sel
    .enter()
    .append("div")
    .attr("class", "chip")
    .style("border-color", (d) => catColor(d))
    .style("color", "#111827");
  enter
    .append("span")
    .text((d) => countryByIso.get(d) || d);
  enter
    .append("button")
    .text("×")
    .on("click", (event, d) => {
      event.stopPropagation();
      selected.delete(d);
      updateMarks();
      renderTimeline.update();
      updateChips();
    });
  sel.exit().remove();
}

function showTooltip(event, html) {
  tooltip
    .style("opacity", 1)
    .html(html)
    .style("left", `${event.pageX + 12}px`)
    .style("top", `${event.pageY + 12}px`);
}
function hideTooltip() {
  tooltip.style("opacity", 0);
}

loadData();
