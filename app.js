(() => {
const SUPABASE_URL = "https://qxcarvhrykjxekwnflnt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wx3fo3AGxdEHj44c2fZCpQ_foxF2prn";

window.instoreSupabase = window.instoreSupabase ||
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );

const supabase = window.instoreSupabase;

const filterDate = document.getElementById("filterDate");
const refreshButton = document.getElementById("refreshButton");
const connectionStatus = document.getElementById("connectionStatus");

console.log("Pengecekan elemen dashboard:", {
    filterDate,
    refreshButton,
    connectionStatus
});

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

    parts.forEach(part => {
        result[part.type] = part.value;
    });

    return `${result.year}-${result.month}-${result.day}`;
}

function setConnectionStatus(message, connected = false) {
    connectionStatus.textContent = message;

    const dot = document.querySelector(".status-dot");

    if (dot) {
        dot.style.backgroundColor = connected
            ? "#22c55e"
            : "#f5c451";
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

    if (!selectedDate) return;

    const currentRequest = ++requestId;

    isLoading = true;
    refreshButton.disabled = true;

    loadingMessage.hidden = false;
    loadingMessage.textContent = "Memuat data...";
    errorMessage.hidden = true;
    emptyMessage.hidden = true;

    try {
        const { data, error } = await supabase
            .from("product_out_daily_summary")
            .select(`
                work_date,
                product_id,
                sku,
                product_name,
                total_out,
                total_cancel,
                net_quantity
            `)
            .eq("work_date", selectedDate)
            .order("net_quantity", { ascending: false });

        if (error) throw error;

        // Abaikan hasil permintaan lama jika ada permintaan yang lebih baru.
        if (
            currentRequest !== requestId ||
            selectedDate !== filterDate.value
        ) {
            return;
        }

        const rows = data || [];

        if (rows.length === 0) {
            resetSummary();
            loadingMessage.hidden = true;
            emptyMessage.hidden = false;
            emptyMessage.textContent =
                "Belum ada data barang keluar pada tanggal ini.";
            return;
        }

        const totals = rows.reduce((result, row) => {
            result.out += Number(row.total_out || 0);
            result.cancel += Number(row.total_cancel || 0);
            // result.returned += Number(row.total_return || 0);
            result.net += Number(row.net_quantity || 0);
            return result;
        }, {
            out: 0,
            cancel: 0,
            returned: 0,
            net: 0
        });

        totalOutElement.textContent = formatNumber(totals.out);
        totalCancelElement.textContent = formatNumber(totals.cancel);
        // totalReturnElement.textContent = formatNumber(totals.returned);
        totalNetElement.textContent = formatNumber(totals.net);

        productCountElement.textContent =
            `${formatNumber(rows.length)} produk`;

        const fragment = document.createDocumentFragment();

        rows.forEach((row, index) => {
            const tr = document.createElement("tr");

            const values = [
                index + 1,
                row.sku || "-",
                row.product_name || "Produk tanpa nama",
                formatNumber(row.total_out),
                formatNumber(row.total_cancel),
                // formatNumber(row.total_return),
                formatNumber(row.net_quantity)
            ];

            values.forEach((value, cellIndex) => {
                const td = document.createElement("td");
                td.textContent = value;

                if (cellIndex === 0) {
                    td.style.color = "#748079";
                }

                tr.appendChild(td);
            });

            fragment.appendChild(tr);
        });

        summaryTableBody.replaceChildren(fragment);

        loadingMessage.hidden = true;
        emptyMessage.hidden = true;

    } catch (error) {
        if (currentRequest !== requestId) return;

        console.error("Gagal memuat rekap:", error);

        loadingMessage.hidden = true;
        errorMessage.hidden = false;
        errorMessage.textContent =
            "Gagal mengambil data. Periksa izin akses Supabase, " +
            "nama view, dan koneksi internet. Detail: " +
            (error.message || "Kesalahan tidak diketahui");

        setConnectionStatus("Gagal memuat data", false);

    } finally {
        if (currentRequest === requestId) {
            isLoading = false;
            refreshButton.disabled = false;
        }
    }
}

// Jadwalkan refresh singkat agar beberapa event berdekatan
// tidak memicu banyak permintaan sekaligus.
function scheduleRefresh() {
    if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        loadDailySummary();
    }, 350);
}

// Dengarkan INSERT, UPDATE, dan DELETE dari tabel event.
function startRealtime() {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    setConnectionStatus("Menghubungkan Realtime...", false);

    realtimeChannel = supabase
        .channel("product-out-dashboard-live")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "product_out_events"
            },
            payload => {
                console.log(
                    "Perubahan event barang keluar:",
                    payload.eventType
                );

                // Ambil ulang view supaya rekap mengikuti
                // hasil perhitungan database terbaru.
                scheduleRefresh();
            }
        )
        .subscribe(status => {
            console.log("Status Supabase Realtime:", status);

            if (status === "SUBSCRIBED") {
                setConnectionStatus("Live · Terhubung", true);
                scheduleRefresh();

            } else if (
                status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT" ||
                status === "CLOSED"
            ) {
                setConnectionStatus("Realtime terputus", false);
            } else {
                setConnectionStatus("Menghubungkan Realtime...", false);
            }
        });
}

refreshButton.addEventListener("click", () => {
    loadDailySummary();
});

filterDate.addEventListener("change", () => {
    loadDailySummary();
});

filterDate.value = getTodayJakarta();

// Muat data awal dan aktifkan listener.
loadDailySummary();
startRealtime();

// Bersihkan listener saat halaman ditutup.
window.addEventListener("pagehide", () => {
    if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
    }

    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
});
})();