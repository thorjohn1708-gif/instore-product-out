(() => {
const SUPABASE_URL = "https://qxcarvhrykjxekwnflnt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wx3fo3AGxdEHj44c2fZCpQ_foxF2prn";

window.instoreSupabase = window.instoreSupabase ||
    window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const supabase = window.instoreSupabase;

const filterDate = document.getElementById("filterDate");
const filterOperator = document.getElementById("filterOperator");
const refreshButton = document.getElementById("refreshButton");
const connectionStatus = document.getElementById("connectionStatus");

const totalOutElement = document.getElementById("totalOut");
const totalCancelElement = document.getElementById("totalCancel");
const totalNetElement = document.getElementById("totalNet");
const productCountElement = document.getElementById("productCount");
const summaryTableBody = document.getElementById("summaryTableBody");

const loadingMessage = document.getElementById("loadingMessage");
const errorMessage = document.getElementById("errorMessage");
const emptyMessage = document.getElementById("emptyMessage");

let realtimeChannel = null;
let refreshTimer = null;
let requestId = 0;
let isLoading = false;

function formatNumber(value) {
    return Number(value || 0).toLocaleString("id-ID");
}

function getTodayJakarta() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const result = {};
    parts.forEach(part => { result[part.type] = part.value; });
    return `${result.year}-${result.month}-${result.day}`;
}

function setConnectionStatus(message, connected = false) {
    connectionStatus.textContent = message;
    const dot = document.querySelector(".status-dot");
    if (dot) {
        dot.style.backgroundColor = connected ? "#22c55e" : "#f5c451";
    }
}

function resetSummary() {
    totalOutElement.textContent = "0";
    totalCancelElement.textContent = "0";
    totalNetElement.textContent = "0";
    productCountElement.textContent = "0 produk";
    summaryTableBody.replaceChildren();
}

async function loadDailySummary() {
    const selectedDate = filterDate.value;
    const selectedOperator = filterOperator ? filterOperator.value : "";

    if (!selectedDate) return;

    const currentRequest = ++requestId;

    isLoading = true;
    refreshButton.disabled = true;

    loadingMessage.hidden = false;
    loadingMessage.textContent = "Memuat data...";
    errorMessage.hidden = true;
    emptyMessage.hidden = true;

    try {
        let query = supabase
            .from("product_out_events")
            .select(`sku, product_name, quantity, event_type, operator_id, occurred_at`)
            .gte("occurred_at", `${selectedDate}T00:00:00+07:00`)
            .lt("occurred_at", `${selectedDate}T23:59:59.999+07:00`);

        if (selectedOperator) {
            query = query.eq("operator_id", selectedOperator);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (currentRequest !== requestId || selectedDate !== filterDate.value) return;

        const events = data || [];

        if (events.length === 0) {
            resetSummary();
            loadingMessage.hidden = true;
            emptyMessage.hidden = false;
            emptyMessage.textContent = selectedOperator
                ? "Belum ada data barang keluar untuk operator ini pada tanggal tersebut."
                : "Belum ada data barang keluar pada tanggal ini.";
            return;
        }

        // Map operator_id ke nama
        const operatorMap = {
            "5769da42-d157-404a-a5e3-35ee97f6be53": "Ali",
            "3eb6a787-e354-45be-9503-a4b875facaf2": "Dimas",
            "b30bf17d-f07f-4f49-9832-012ec1f19a3e": "Faisal",
            "684abdd2-55f8-4098-8971-165af38d2555": "Iis",
            "947ebd5e-bfef-4adf-9368-2ada61fb2820": "Keyla",
            "5d09666a-2f91-4565-aade-eecd79e86d3f": "Nadila",
            "8642c323-b118-416f-ae85-e659a24bb8ba": "Nisa",
            "a1249731-d7d6-4c26-91f8-af86c7ae0741": "Rizky"
        };

        // Agregasi per SKU + operator
        const summaryMap = new Map();

        events.forEach(event => {
            const sku = event.sku || "unknown";
            const opName = operatorMap[event.operator_id] || "Unknown";
            const key = `${sku}|${opName}`;

            if (!summaryMap.has(key)) {
                summaryMap.set(key, {
                    sku,
                    product_name: event.product_name,
                    operator: opName,
                    total_out: 0,
                    total_cancel: 0,
                    valid: 0
                });
            }
            const item = summaryMap.get(key);
            const qty = Number(event.quantity || 0);
            if (event.event_type === "OUT") item.total_out += qty;
            else if (event.event_type === "CANCEL") item.total_cancel += qty;
            item.valid = item.total_out - item.total_cancel;
        });

        // Group by SKU untuk tampilan
        const skuGroups = new Map();
        for (const item of summaryMap.values()) {
            if (!skuGroups.has(item.sku)) {
                skuGroups.set(item.sku, {
                    sku: item.sku,
                    product_name: item.product_name,
                    total_out: 0,
                    total_cancel: 0,
                    valid: 0,
                    operators: []
                });
            }
            const group = skuGroups.get(item.sku);
            group.total_out += item.total_out;
            group.total_cancel += item.total_cancel;
            group.valid += item.valid;
            if (item.valid > 0) {
                group.operators.push({ name: item.operator, valid: item.valid });
            }
        }

        const rows = Array.from(skuGroups.values())
            .sort((a, b) => b.valid - a.valid);

        const totals = rows.reduce((result, row) => {
            result.out += row.total_out;
            result.cancel += row.total_cancel;
            result.net += row.valid;
            return result;
        }, { out: 0, cancel: 0, net: 0 });

        totalOutElement.textContent = formatNumber(totals.out);
        totalCancelElement.textContent = formatNumber(totals.cancel);
        totalNetElement.textContent = formatNumber(totals.net);
        productCountElement.textContent = `${formatNumber(rows.length)} produk`;

        const fragment = document.createDocumentFragment();

        rows.forEach((row) => {
            const card = document.createElement("div");
            card.className = "rekap-card";

            const operatorLines = row.operators
                .sort((a, b) => b.valid - a.valid)
                .map(op => `<div class="rekap-operator">• ${op.name}: Valid ${formatNumber(op.valid)}</div>`)
                .join("");

            card.innerHTML = `
                <div class="rekap-card-header">
                    <div class="rekap-card-name">${row.product_name || "Produk tanpa nama"}</div>
                    <div class="rekap-card-sku">${row.sku || "-"}</div>
                </div>
                <div class="rekap-card-stats">
                    <div class="rekap-stat">
                        <div class="rekap-stat-label">Tercatat</div>
                        <div class="rekap-stat-value out">${formatNumber(row.total_out)}</div>
                    </div>
                    <div class="rekap-stat">
                        <div class="rekap-stat-label">Cancel</div>
                        <div class="rekap-stat-value cancel">${formatNumber(row.total_cancel)}</div>
                    </div>
                    <div class="rekap-stat">
                        <div class="rekap-stat-label">Valid</div>
                        <div class="rekap-stat-value net">${formatNumber(row.valid)}</div>
                    </div>
                </div>
                ${operatorLines ? `<div class="rekap-operators">${operatorLines}</div>` : ""}
            `;

            fragment.appendChild(card);
        });

        summaryTableBody.replaceChildren(fragment);
        loadingMessage.hidden = true;
        emptyMessage.hidden = true;

    } catch (error) {
        if (currentRequest !== requestId) return;
        console.error("Gagal memuat rekap:", error);
        loadingMessage.hidden = true;
        errorMessage.hidden = false;
        errorMessage.textContent = "Gagal mengambil data. Detail: " + (error.message || "Kesalahan tidak diketahui");
        setConnectionStatus("Gagal memuat data", false);
    } finally {
        if (currentRequest === requestId) {
            isLoading = false;
            refreshButton.disabled = false;
        }
    }
}

function scheduleRefresh() {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        loadDailySummary();
    }, 350);
}

function startRealtime() {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
    setConnectionStatus("Menghubungkan Realtime...", false);

    realtimeChannel = supabase
        .channel("product-out-dashboard-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "product_out_events" }, () => {
            scheduleRefresh();
        })
        .subscribe(status => {
            if (status === "SUBSCRIBED") {
                setConnectionStatus("Live · Terhubung", true);
                scheduleRefresh();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                setConnectionStatus("Realtime terputus", false);
            } else {
                setConnectionStatus("Menghubungkan Realtime...", false);
            }
        });
}

refreshButton.addEventListener("click", () => loadDailySummary());
filterDate.addEventListener("change", () => loadDailySummary());
filterOperator.addEventListener("change", () => loadDailySummary());

filterDate.value = getTodayJakarta();
loadDailySummary();
startRealtime();

window.addEventListener("pagehide", () => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
});
})();