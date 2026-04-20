(function () {
  "use strict";

  const COL = {
    order_id: ["order_id", "orderid", "order"],
    customer_id: ["customer_id", "customerid", "customer"],
    purchase_date: ["purchase_date", "date", "order_date", "purchasedate"],
    product_category: ["product_category", "category", "productcategory"],
    quantity: ["quantity", "qty", "units"],
    total_amount: ["total_amount", "amount", "total", "revenue", "line_total"],
    region: ["region", "location", "area"],
  };

  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /** Max rows rendered in the transactions table (full dataset still drives charts, stats, export). */
  const TABLE_PREVIEW_MAX = 2000;

  const currency = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const pct = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  const SAMPLE_CSV = `order_id,customer_id,purchase_date,product_category,quantity,total_amount,region
ORD-1001,C-204,2025-11-02,Electronics,1,1299,North
ORD-1002,C-118,2025-11-03,Apparel,2,148,South
ORD-1003,C-204,2025-11-05,Home & Garden,1,89,West
ORD-1004,C-092,2025-11-06,Groceries,8,64,North
ORD-1005,C-331,2025-11-07,Electronics,1,799,East
ORD-1006,C-118,2025-11-08,Apparel,3,210,South
ORD-1007,C-445,2025-11-10,Sports,2,178,West
ORD-1008,C-092,2025-11-11,Groceries,12,96,North
ORD-1009,C-204,2025-11-12,Electronics,2,458,West
ORD-1010,C-512,2025-11-14,Home & Garden,4,156,South
ORD-1011,C-331,2025-11-15,Beauty,1,42,East
ORD-1012,C-667,2025-11-16,Electronics,1,1099,North
ORD-1013,C-118,2025-11-18,Apparel,1,79,South
ORD-1014,C-092,2025-11-19,Groceries,6,72,North
ORD-1015,C-445,2025-11-20,Sports,1,320,West
ORD-1016,C-512,2025-11-22,Home & Garden,2,98,South
ORD-1017,C-204,2025-11-23,Electronics,1,249,West
ORD-1018,C-331,2025-11-24,Beauty,3,96,East
ORD-1019,C-667,2025-11-25,Groceries,10,80,North
ORD-1020,C-118,2025-11-26,Apparel,2,134,South
ORD-1021,C-092,2025-11-28,Electronics,1,599,North
ORD-1022,C-445,2025-11-29,Sports,3,267,West
ORD-1023,C-512,2025-12-01,Home & Garden,1,45,South
ORD-1024,C-204,2025-12-02,Electronics,1,899,West
ORD-1025,C-331,2025-12-03,Apparel,4,220,East
ORD-1026,C-118,2025-12-05,Groceries,15,120,South
ORD-1027,C-667,2025-12-06,Beauty,2,68,North
ORD-1028,C-092,2025-12-08,Electronics,1,349,North
ORD-1029,C-512,2025-12-10,Home & Garden,6,198,South
ORD-1030,C-445,2025-12-12,Sports,2,190,West`;

  let allRecords = [];
  let charts = {
    category: null,
    trend: null,
    region: null,
    weekday: null,
    topCustomers: null,
    unitsCategory: null,
    monthly: null,
    aovCategory: null,
    ordersRegion: null,
    topCategoriesUnits: null,
    cumulative: null,
  };

  function parseCSV(text) {
    const rows = [];
    let i = 0;
    const len = text.length;
    let field = "";
    let row = [];
    let inQuotes = false;

    function pushField() {
      row.push(field);
      field = "";
    }
    function pushRow() {
      if (row.length === 1 && row[0] === "") return;
      rows.push(row);
      row = [];
    }

    while (i < len) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        pushField();
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      if (c === "\n") {
        pushField();
        pushRow();
        i++;
        continue;
      }
      field += c;
      i++;
    }
    pushField();
    if (row.length) pushRow();
    return rows;
  }

  function normalizeHeader(h) {
    return String(h || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  function mapColumns(headers) {
    const norm = headers.map(normalizeHeader);
    const idx = {};
    for (const key of Object.keys(COL)) {
      const aliases = COL[key];
      let found = -1;
      for (let j = 0; j < norm.length; j++) {
        if (aliases.includes(norm[j])) {
          found = j;
          break;
        }
      }
      idx[key] = found;
    }
    return idx;
  }

  function parseNumber(v) {
    if (v == null || v === "") return NaN;
    const s = String(v).replace(/,/g, "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function parseDateCell(v) {
    if (!v) return null;
    const s = String(v).trim();
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function rowsToRecords(rows) {
    if (!rows.length) return [];
    const headers = rows[0];
    const idx = mapColumns(headers);
    if (idx.total_amount < 0) {
      throw new Error('Missing required column: total_amount (or "amount", "total")');
    }
    const data = [];
    for (let r = 1; r < rows.length; r++) {
      const line = rows[r];
      if (line.every((c) => !String(c || "").trim())) continue;
      const amount = parseNumber(line[idx.total_amount]);
      if (!Number.isFinite(amount)) continue;
      const rec = {
        order_id: idx.order_id >= 0 ? String(line[idx.order_id] ?? "").trim() : `row-${r}`,
        customer_id:
          idx.customer_id >= 0 ? String(line[idx.customer_id] ?? "").trim() : "",
        purchase_date:
          idx.purchase_date >= 0 ? parseDateCell(line[idx.purchase_date]) : null,
        product_category:
          idx.product_category >= 0
            ? String(line[idx.product_category] ?? "Other").trim() || "Other"
            : "Other",
        quantity: idx.quantity >= 0 ? parseNumber(line[idx.quantity]) || 0 : 0,
        total_amount: amount,
        region:
          idx.region >= 0 ? String(line[idx.region] ?? "").trim() || "—" : "—",
      };
      data.push(rec);
    }
    return data;
  }

  function aggregate(records) {
    const byCategory = new Map();
    const byCategoryUnits = new Map();
    const byCategoryOrders = new Map();
    const byDay = new Map();
    const byMonth = new Map();
    const byRegion = new Map();
    const byRegionOrders = new Map();
    const byWeekday = new Array(7).fill(0);
    const customerMap = new Map();
    const customerSet = new Set();
    let revenue = 0;
    let units = 0;

    for (const r of records) {
      revenue += r.total_amount;
      units += r.quantity;
      if (r.customer_id) customerSet.add(r.customer_id);
      const cat = r.product_category;
      byCategory.set(cat, (byCategory.get(cat) || 0) + r.total_amount);
      byCategoryUnits.set(cat, (byCategoryUnits.get(cat) || 0) + r.quantity);
      byCategoryOrders.set(cat, (byCategoryOrders.get(cat) || 0) + 1);
      const reg = r.region;
      byRegion.set(reg, (byRegion.get(reg) || 0) + r.total_amount);
      byRegionOrders.set(reg, (byRegionOrders.get(reg) || 0) + 1);
      if (r.purchase_date) {
        const key = r.purchase_date.toISOString().slice(0, 10);
        const monthKey = r.purchase_date.toISOString().slice(0, 7);
        byDay.set(key, (byDay.get(key) || 0) + r.total_amount);
        byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + r.total_amount);
        byWeekday[r.purchase_date.getDay()] += r.total_amount;
      }
      if (r.customer_id) {
        const cur = customerMap.get(r.customer_id) || { revenue: 0, orders: 0 };
        cur.revenue += r.total_amount;
        cur.orders += 1;
        customerMap.set(r.customer_id, cur);
      }
    }

    const daysSorted = [...byDay.keys()].sort();
    const monthsSorted = [...byMonth.keys()].sort();
    const topCustomers = [...customerMap.entries()]
      .map(([id, v]) => ({ id, revenue: v.revenue, orders: v.orders }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      revenue,
      units,
      orders: records.length,
      customers: customerSet.size,
      byCategory,
      byCategoryUnits,
      byCategoryOrders,
      byDay: daysSorted.map((d) => ({ date: d, value: byDay.get(d) })),
      byMonth: monthsSorted.map((m) => ({ month: m, value: byMonth.get(m) })),
      byRegion,
      byRegionOrders,
      byWeekday,
      topCustomers,
    };
  }

  function buildInsights(agg, records) {
    const lines = [];
    if (!records.length) return lines;

    if (agg.revenue > 0 && agg.byCategory.size) {
      const sorted = [...agg.byCategory.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      const share = top[1] / agg.revenue;
      lines.push(
        `Top category is <strong>${escapeHtml(top[0])}</strong>, about ${pct.format(share)} of filtered revenue.`
      );
    }

    let maxW = 0;
    let maxWi = 0;
    for (let i = 0; i < 7; i++) {
      if (agg.byWeekday[i] > maxW) {
        maxW = agg.byWeekday[i];
        maxWi = i;
      }
    }
    if (maxW > 0) {
      lines.push(
        `Strongest weekday (by revenue) is <strong>${WEEKDAY_LABELS[maxWi]}</strong> in this slice.`
      );
    }

    if (agg.topCustomers.length) {
      const t = agg.topCustomers[0];
      const share = agg.revenue > 0 ? t.revenue / agg.revenue : 0;
      lines.push(
        `Highest-spend customer is <strong>${escapeHtml(t.id)}</strong> (${currency.format(t.revenue)}, ~${pct.format(share)} of revenue).`
      );
    }

    if (agg.orders > 0) {
      lines.push(
        `Average order value is <strong>${currency.format(Math.round(agg.revenue / agg.orders))}</strong> across ${agg.orders} orders.`
      );
    }

    const withDate = records.filter((r) => r.purchase_date).length;
    if (withDate < records.length) {
      lines.push(
        `<strong>${records.length - withDate}</strong> row(s) lack a parseable date; weekday and trend charts use dated rows only.`
      );
    }

    return lines;
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function destroyAllCharts() {
    Object.keys(charts).forEach((k) => destroyChart(k));
  }

  const chartColors = {
    grid: "rgba(255,255,255,0.06)",
    text: "#8b95a8",
    accent: "#5eead4",
    palette: ["#5eead4", "#38bdf8", "#a78bfa", "#fb923c", "#f472b6", "#34d399", "#fbbf24"],
  };

  function doughnutColors(n) {
    return Array.from({ length: n }, (_, i) => chartColors.palette[i % chartColors.palette.length]);
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function renderCharts(agg) {
    if (typeof Chart === "undefined") return;

    const catLabels = [...agg.byCategory.keys()];
    const catValues = catLabels.map((k) => agg.byCategory.get(k));

    destroyChart("category");
    const ctxCat = document.getElementById("chartCategory");
    if (ctxCat && catLabels.length) {
      charts.category = new Chart(ctxCat, {
        type: "doughnut",
        data: {
          labels: catLabels,
          datasets: [
            {
              data: catValues,
              backgroundColor: doughnutColors(catLabels.length),
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "right",
              labels: { color: chartColors.text, boxWidth: 12, padding: 12 },
            },
          },
        },
      });
    }

    destroyChart("trend");
    const ctxTrend = document.getElementById("chartTrend");
    if (ctxTrend) {
      if (agg.byDay.length) {
        charts.trend = new Chart(ctxTrend, {
          type: "line",
          data: {
            labels: agg.byDay.map((d) => d.date),
            datasets: [
              {
                label: "Revenue",
                data: agg.byDay.map((d) => d.value),
                borderColor: chartColors.accent,
                backgroundColor: "rgba(94, 234, 212, 0.12)",
                fill: true,
                tension: 0.3,
                pointRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                grid: { color: chartColors.grid },
                ticks: { color: chartColors.text, maxRotation: 45 },
              },
              y: {
                grid: { color: chartColors.grid },
                ticks: {
                  color: chartColors.text,
                  callback: (v) => (v >= 1000 ? v / 1000 + "k" : v),
                },
              },
            },
            plugins: { legend: { display: false } },
          },
        });
      }
    }

    destroyChart("weekday");
    const ctxWd = document.getElementById("chartWeekday");
    if (ctxWd) {
      const hasData = agg.byWeekday.some((v) => v > 0);
      if (hasData) {
        charts.weekday = new Chart(ctxWd, {
          type: "bar",
          data: {
            labels: WEEKDAY_LABELS,
            datasets: [
              {
                label: "Revenue",
                data: [...agg.byWeekday],
                backgroundColor: WEEKDAY_LABELS.map((_, i) =>
                  hexToRgba(doughnutColors(7)[i], 0.75)
                ),
                borderRadius: 6,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: chartColors.text },
              },
              y: {
                grid: { color: chartColors.grid },
                ticks: { color: chartColors.text },
              },
            },
            plugins: { legend: { display: false } },
          },
        });
      }
    }

    destroyChart("region");
    const ctxReg = document.getElementById("chartRegion");
    const regLabels = [...agg.byRegion.keys()];
    const regValues = regLabels.map((k) => agg.byRegion.get(k));
    if (ctxReg && regLabels.length) {
      charts.region = new Chart(ctxReg, {
        type: "bar",
        data: {
          labels: regLabels,
          datasets: [
            {
              label: "Revenue",
              data: regValues,
              backgroundColor: doughnutColors(regLabels.length).map((c) => hexToRgba(c, 0.78)),
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: chartColors.text },
            },
            y: {
              grid: { color: chartColors.grid },
              ticks: { color: chartColors.text },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    destroyChart("topCustomers");
    const ctxTop = document.getElementById("chartTopCustomers");
    const top = agg.topCustomers.slice(0, 8);
    if (ctxTop && top.length) {
      charts.topCustomers = new Chart(ctxTop, {
        type: "bar",
        data: {
          labels: top.map((t) => t.id),
          datasets: [
            {
              label: "Revenue",
              data: top.map((t) => t.revenue),
              backgroundColor: doughnutColors(top.length).map((c) => hexToRgba(c, 0.8)),
              borderRadius: 6,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: chartColors.grid },
              ticks: { color: chartColors.text },
            },
            y: {
              grid: { display: false },
              ticks: { color: chartColors.text },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    destroyChart("unitsCategory");
    const ctxUnitsCat = document.getElementById("chartUnitsCategory");
    const catUnitLabels = [...agg.byCategoryUnits.keys()];
    const catUnitValues = catUnitLabels.map((k) => agg.byCategoryUnits.get(k));
    if (ctxUnitsCat && catUnitLabels.length) {
      charts.unitsCategory = new Chart(ctxUnitsCat, {
        type: "bar",
        data: {
          labels: catUnitLabels,
          datasets: [
            {
              label: "Units",
              data: catUnitValues,
              backgroundColor: doughnutColors(catUnitLabels.length).map((c) => hexToRgba(c, 0.8)),
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: chartColors.text },
            },
            y: {
              grid: { color: chartColors.grid },
              ticks: { color: chartColors.text },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    destroyChart("monthly");
    const ctxMonthly = document.getElementById("chartMonthly");
    if (ctxMonthly && agg.byMonth.length) {
      charts.monthly = new Chart(ctxMonthly, {
        type: "line",
        data: {
          labels: agg.byMonth.map((d) => d.month),
          datasets: [
            {
              label: "Revenue",
              data: agg.byMonth.map((d) => d.value),
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.14)",
              fill: true,
              tension: 0.3,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: chartColors.grid },
              ticks: { color: chartColors.text },
            },
            y: {
              grid: { color: chartColors.grid },
              ticks: {
                color: chartColors.text,
                callback: (v) => (v >= 1000 ? v / 1000 + "k" : v),
              },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    destroyChart("aovCategory");
    const ctxAovCat = document.getElementById("chartAovCategory");
    const aovLabels = [...agg.byCategory.keys()];
    const aovValues = aovLabels.map((k) => {
      const rev = agg.byCategory.get(k) || 0;
      const ord = agg.byCategoryOrders.get(k) || 1;
      return rev / ord;
    });
    if (ctxAovCat && aovLabels.length) {
      charts.aovCategory = new Chart(ctxAovCat, {
        type: "bar",
        data: {
          labels: aovLabels,
          datasets: [
            {
              label: "AOV",
              data: aovValues,
              backgroundColor: doughnutColors(aovLabels.length).map((c) => hexToRgba(c, 0.8)),
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: chartColors.text },
            },
            y: {
              grid: { color: chartColors.grid },
              ticks: {
                color: chartColors.text,
                callback: (v) => (v >= 1000 ? v / 1000 + "k" : v),
              },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    destroyChart("ordersRegion");
    const ctxOrdersReg = document.getElementById("chartOrdersRegion");
    const regionOrderLabels = [...agg.byRegionOrders.keys()];
    const regionOrderValues = regionOrderLabels.map((k) => agg.byRegionOrders.get(k));
    if (ctxOrdersReg && regionOrderLabels.length) {
      charts.ordersRegion = new Chart(ctxOrdersReg, {
        type: "doughnut",
        data: {
          labels: regionOrderLabels,
          datasets: [
            {
              data: regionOrderValues,
              backgroundColor: doughnutColors(regionOrderLabels.length),
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "right",
              labels: { color: chartColors.text, boxWidth: 12, padding: 12 },
            },
          },
        },
      });
    }

    destroyChart("topCategoriesUnits");
    const ctxTopCatsUnits = document.getElementById("chartTopCategoriesUnits");
    const topCatUnits = [...agg.byCategoryUnits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (ctxTopCatsUnits && topCatUnits.length) {
      charts.topCategoriesUnits = new Chart(ctxTopCatsUnits, {
        type: "bar",
        data: {
          labels: topCatUnits.map((x) => x[0]),
          datasets: [
            {
              label: "Units",
              data: topCatUnits.map((x) => x[1]),
              backgroundColor: doughnutColors(topCatUnits.length).map((c) => hexToRgba(c, 0.8)),
              borderRadius: 6,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: chartColors.grid },
              ticks: { color: chartColors.text },
            },
            y: {
              grid: { display: false },
              ticks: { color: chartColors.text },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    destroyChart("cumulative");
    const ctxCumulative = document.getElementById("chartCumulative");
    if (ctxCumulative && agg.byDay.length) {
      let running = 0;
      const cumulativeValues = agg.byDay.map((d) => {
        running += d.value;
        return running;
      });
      charts.cumulative = new Chart(ctxCumulative, {
        type: "line",
        data: {
          labels: agg.byDay.map((d) => d.date),
          datasets: [
            {
              label: "Cumulative revenue",
              data: cumulativeValues,
              borderColor: "#a78bfa",
              backgroundColor: "rgba(167, 139, 250, 0.16)",
              fill: true,
              tension: 0.25,
              pointRadius: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: chartColors.grid },
              ticks: { color: chartColors.text, maxRotation: 45 },
            },
            y: {
              grid: { color: chartColors.grid },
              ticks: {
                color: chartColors.text,
                callback: (v) => (v >= 1000 ? v / 1000 + "k" : v),
              },
            },
          },
          plugins: { legend: { display: false } },
        },
      });
    }
  }

  function renderInsights(agg, records) {
    const ul = document.getElementById("insightsList");
    if (!ul) return;
    const items = buildInsights(agg, records);
    ul.innerHTML = items.map((html) => `<li>${html}</li>`).join("");
    if (!items.length) {
      ul.innerHTML = "<li>No insights yet — load data or relax filters.</li>";
    }
  }

  function renderTopCustomersTable(agg) {
    const tbody = document.getElementById("topCustomersBody");
    const cap = document.getElementById("topCustCaption");
    if (!tbody) return;
    const rev = agg.revenue || 1;
    const rows = agg.topCustomers.slice(0, 8);
    tbody.innerHTML = rows
      .map(
        (r, i) =>
          `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.id)}</td>
          <td>${r.orders}</td>
          <td>${currency.format(r.revenue)}</td>
          <td>${pct.format(r.revenue / rev)}</td>
        </tr>`
      )
      .join("");
    if (cap) {
      cap.textContent = rows.length ? "Ranked by revenue in current filter" : "";
    }
  }

  function renderTable(records) {
    const tbody = document.getElementById("tableBody");
    const rowCount = document.getElementById("rowCount");
    if (!tbody) return;
    const sorted = [...records].sort((a, b) => {
      const da = a.purchase_date ? a.purchase_date.getTime() : 0;
      const db = b.purchase_date ? b.purchase_date.getTime() : 0;
      return db - da;
    });
    const top = sorted.slice(0, TABLE_PREVIEW_MAX);
    tbody.innerHTML = top
      .map(
        (r) =>
          `<tr>
          <td>${escapeHtml(r.order_id)}</td>
          <td>${escapeHtml(r.customer_id || "—")}</td>
          <td>${r.purchase_date ? escapeHtml(r.purchase_date.toISOString().slice(0, 10)) : "—"}</td>
          <td>${escapeHtml(r.product_category)}</td>
          <td>${r.quantity}</td>
          <td>${currency.format(r.total_amount)}</td>
          <td>${escapeHtml(r.region)}</td>
        </tr>`
      )
      .join("");
    if (rowCount) {
      rowCount.textContent =
        records.length > TABLE_PREVIEW_MAX
          ? `Showing ${TABLE_PREVIEW_MAX} of ${records.length} filtered rows (scroll the table)`
          : `${records.length} filtered rows`;
    }
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function setStats(agg, records) {
    const aov = records.length ? agg.revenue / records.length : 0;
    const el = (id, text) => {
      const n = document.getElementById(id);
      if (n) n.textContent = text;
    };
    el("statRevenue", currency.format(agg.revenue));
    el("statOrders", String(agg.orders));
    el("statCustomers", String(agg.customers));
    el("statAov", currency.format(Math.round(aov)));
    el("statUnits", String(Math.round(agg.units)));
  }

  function setStatus(message, isError) {
    const s = document.getElementById("status");
    if (!s) return;
    s.textContent = message;
    s.classList.toggle("error", !!isError);
  }

  function showToast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      t.hidden = true;
    }, 3200);
  }

  function dateInputValue(d) {
    if (!d) return "";
    return d.toISOString().slice(0, 10);
  }

  function populateFilters(records) {
    const regions = new Set();
    const categories = new Set();
    let minD = null;
    let maxD = null;

    for (const r of records) {
      if (r.region && r.region !== "—") regions.add(r.region);
      categories.add(r.product_category);
      if (r.purchase_date) {
        const t = r.purchase_date.getTime();
        if (minD === null || t < minD) minD = t;
        if (maxD === null || t > maxD) maxD = t;
      }
    }

    const regSel = document.getElementById("filterRegion");
    const catSel = document.getElementById("filterCategory");
    const fromEl = document.getElementById("filterFrom");
    const toEl = document.getElementById("filterTo");

    if (regSel) {
      const cur = regSel.value;
      regSel.innerHTML = '<option value="">All regions</option>';
      [...regions].sort().forEach((r) => {
        const o = document.createElement("option");
        o.value = r;
        o.textContent = r;
        regSel.appendChild(o);
      });
      if ([...regions].includes(cur)) regSel.value = cur;
    }

    if (catSel) {
      const cur = catSel.value;
      catSel.innerHTML = '<option value="">All categories</option>';
      [...categories].sort().forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        catSel.appendChild(o);
      });
      if ([...categories].includes(cur)) catSel.value = cur;
    }

    if (fromEl && minD !== null) fromEl.min = dateInputValue(new Date(minD));
    if (toEl && maxD !== null) toEl.max = dateInputValue(new Date(maxD));
    if (fromEl && minD !== null && !fromEl.value) fromEl.value = dateInputValue(new Date(minD));
    if (toEl && maxD !== null && !toEl.value) toEl.value = dateInputValue(new Date(maxD));
  }

  function getFilteredRecords() {
    const fromEl = document.getElementById("filterFrom");
    const toEl = document.getElementById("filterTo");
    const regSel = document.getElementById("filterRegion");
    const catSel = document.getElementById("filterCategory");
    const searchEl = document.getElementById("filterSearch");

    const from = fromEl && fromEl.value ? new Date(fromEl.value + "T12:00:00") : null;
    const to = toEl && toEl.value ? new Date(toEl.value + "T12:00:00") : null;
    const region = regSel ? regSel.value : "";
    const category = catSel ? catSel.value : "";
    const q = searchEl ? searchEl.value.trim().toLowerCase() : "";

    return allRecords.filter((r) => {
      if (from && r.purchase_date) {
        const d = new Date(r.purchase_date);
        d.setHours(0, 0, 0, 0);
        const f = new Date(from);
        f.setHours(0, 0, 0, 0);
        if (d < f) return false;
      } else if (from && !r.purchase_date) {
        return false;
      }
      if (to && r.purchase_date) {
        const d = new Date(r.purchase_date);
        d.setHours(0, 0, 0, 0);
        const t = new Date(to);
        t.setHours(0, 0, 0, 0);
        if (d > t) return false;
      } else if (to && !r.purchase_date) {
        return false;
      }
      if (region && r.region !== region) return false;
      if (category && r.product_category !== category) return false;
      if (q) {
        const oid = (r.order_id || "").toLowerCase();
        const cid = (r.customer_id || "").toLowerCase();
        if (!oid.includes(q) && !cid.includes(q)) return false;
      }
      return true;
    });
  }

  function resetFilters() {
    const fromEl = document.getElementById("filterFrom");
    const toEl = document.getElementById("filterTo");
    const regSel = document.getElementById("filterRegion");
    const catSel = document.getElementById("filterCategory");
    const searchEl = document.getElementById("filterSearch");
    if (regSel) regSel.value = "";
    if (catSel) catSel.value = "";
    if (searchEl) searchEl.value = "";
    populateFilters(allRecords);
    refresh();
  }

  function recordsToCsv(records) {
    const header =
      "order_id,customer_id,purchase_date,product_category,quantity,total_amount,region";
    const lines = [header];
    for (const r of records) {
      const d = r.purchase_date ? r.purchase_date.toISOString().slice(0, 10) : "";
      const row = [
        r.order_id,
        r.customer_id,
        d,
        r.product_category,
        String(r.quantity),
        String(r.total_amount),
        r.region,
      ].map((cell) => {
        const s = String(cell ?? "");
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      });
      lines.push(row.join(","));
    }
    return lines.join("\r\n");
  }

  function exportFilteredCsv() {
    const filtered = getFilteredRecords();
    if (!filtered.length) {
      showToast("Nothing to export — adjust filters or load data.");
      return;
    }
    const blob = new Blob([recordsToCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `purchase_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Exported ${filtered.length} rows.`);
  }

  function refresh() {
    const records = getFilteredRecords();
    if (!allRecords.length) {
      setStatus("No data loaded.", true);
      return;
    }
    if (!records.length) {
      setStatus("No rows match the current filters.", true);
      destroyAllCharts();
      const agg = aggregate([]);
      setStats(agg, []);
      renderInsights(agg, []);
      renderTopCustomersTable(agg);
      renderTable([]);
      return;
    }
    const agg = aggregate(records);
    setStats(agg, records);
    setStatus(`Showing ${records.length} of ${allRecords.length} rows (filtered).`);
    renderCharts(agg);
    renderInsights(agg, records);
    renderTopCustomersTable(agg);
    renderTable(records);
  }

  function runAnalysis(records) {
    allRecords = records;
    if (!records.length) {
      setStatus("No valid rows found. Check column names and numeric amounts.", true);
      return;
    }
    populateFilters(allRecords);
    refresh();
  }

  function processText(text) {
    const rows = parseCSV(text);
    const records = rowsToRecords(rows);
    runAnalysis(records);
  }

  function processTextSafe(text) {
    try {
      processText(text);
      return true;
    } catch (err) {
      setStatus(err.message || String(err), true);
      showToast("Could not parse CSV.");
      return false;
    }
  }

  async function tryLoadDataCsv() {
    try {
      const res = await fetch("data.csv", { cache: "no-store" });
      if (!res.ok) return false;
      const text = await res.text();
      processTextSafe(text);
      return true;
    } catch {
      return false;
    }
  }

  function bindFilters() {
    const ids = ["filterFrom", "filterTo", "filterRegion", "filterCategory", "filterSearch"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => refresh());
      if (el.tagName === "INPUT" && el.type === "search") {
        let t;
        el.addEventListener("input", () => {
          clearTimeout(t);
          t = setTimeout(() => refresh(), 180);
        });
      }
    });
    document.getElementById("btnReset")?.addEventListener("click", resetFilters);
    document.getElementById("btnExport")?.addEventListener("click", exportFilteredCsv);
  }

  document.getElementById("csvFile")?.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (processTextSafe(String(reader.result || ""))) {
        showToast(`Loaded ${file.name} (${allRecords.length} rows)`);
      }
    };
    reader.readAsText(file);
  });

  function init() {
    bindFilters();
    setStatus("Loading data…");
    tryLoadDataCsv().then((ok) => {
      if (!ok) {
        processTextSafe(SAMPLE_CSV);
        const s = document.getElementById("status");
        if (s && s.textContent) {
          s.textContent =
            s.textContent +
            " · Embedded sample (use a local server or Import CSV for your own file).";
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
