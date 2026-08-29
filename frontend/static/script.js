"use strict";

/*
============================================================
 ENTERPRISE LINUX SERVER MANAGEMENT PLATFORM
 Frontend Controller
============================================================

 This file is responsible for:

 1. Navigation
 2. Rendering pages
 3. Calling the FastAPI backend
 4. Receiving CPU information
 5. Maintaining CPU history
 6. Updating the CPU graph
 7. Refreshing CPU data every 5 seconds

 IMPORTANT:

 The Linux/Bash implementation is NOT changed here.

 Browser
    |
    | GET /api/cpu
    v
 FastAPI
    |
    | executes system_health.sh
    v
 Linux server
    |
    v
 CPU value
============================================================
*/


/* ==========================================================
   GLOBAL ELEMENTS
========================================================== */

const contentEl =
    document.getElementById("content");

const sidebarEl =
    document.querySelector(".sidebar");

const healthToggleBtn =
    document.getElementById("health-toggle");

const healthMenuEl =
    document.getElementById("health-menu");


/* ==========================================================
   CPU STATE
========================================================== */

/*
 * Stores EVERY CPU reading received by the browser.
 *
 * Example:
 *
 * [
 *   {
 *      value: 4.8,
 *      time: Date
 *   },
 *   {
 *      value: 7.2,
 *      time: Date
 *   }
 * ]
 *
 * IMPORTANT:
 *
 * We intentionally DO NOT remove old readings.
 */

let cpuHistory = [];


/*
 * Chart.js chart object.
 */

let cpuChart = null;


/*
 * Refresh timer.
 */

let cpuRefreshTimer = null;


/*
 * Index into cpuHistory where the
 * currently visible chart window starts.
 */

let chartWindowStart = 0;


/*
 * When true, the chart window automatically
 * follows the newest reading (default).
 *
 * Turned off when the user drags the
 * scrubber slider away from the live edge,
 * turned back on by the "Live" button.
 */

let followLive = true;


/*
 * ==========================================================
 * TIME RANGE FILTER STATE
 * ==========================================================
 *
 * selectedTimeRange : "live" | "1h" | "5h" | "12h" | "custom"
 * customRangeStart  : Date | null (only set for "custom")
 * customRangeEnd    : Date | null (only set for "custom")
 * isPaused          : true when live data collection is paused
 * refreshIntervalMs : how often /api/cpu is polled
 * filteredReadings  : cpuHistory filtered down to the readings
 *                      that belong to the currently selected
 *                      time range. The chart, KPIs, and the
 *                      scrollbar are always derived from this
 *                      array -- never from cpuHistory directly.
 */

let selectedTimeRange = "live";

let customRangeStart = null;

let customRangeEnd = null;

let isPaused = false;

let refreshIntervalMs = 5000;

let filteredReadings = [];


/*
 * chartDisplayReadings : what the CHART actually plots. For
 *                        short ranges (Live/1h/5h/12h) this is
 *                        identical to filteredReadings. For
 *                        day-scale ranges it is a downsampled
 *                        (aggregated) version of it, so the
 *                        chart never tries to draw thousands of
 *                        raw points. KPIs always use the exact,
 *                        non-aggregated filteredReadings.
 */

let chartDisplayReadings = [];


/*
 * 0 means "no aggregation, raw readings". Any other value is
 * the bucket size (in ms) currently used to build
 * chartDisplayReadings.
 */

let aggregationIntervalMs = 0;


/*
 * Temporary state for the Custom Date + Time Range picker.
 * Nothing here is applied until the user clicks "Apply" --
 * Cancel simply discards it.
 */

let dtPicker = {

    from: {
        year: 0,
        month: 0,
        selectedDate: null
    },

    to: {
        year: 0,
        month: 0,
        selectedDate: null
    }
};


/* ==========================================================
   CONSTANTS
========================================================== */

const CPU_REFRESH_INTERVAL_DEFAULT = 5000;

const WARNING_THRESHOLD = 50;

const CRITICAL_THRESHOLD = 80;


/*
 * How much horizontal space one CPU reading receives.
 *
 * More readings = wider graph.
 */

const PIXELS_PER_POINT = 100;


/*
 * Minimum graph width.
 */

const MIN_CHART_WIDTH = 1100;


/*
 * The graph only DRAWS the most recent
 * CHART_WINDOW_SIZE readings so it always
 * fits inside its container.
 *
 * Older readings are NOT deleted from
 * cpuHistory -- they still count towards
 * the statistics cards (average, peak,
 * total readings).
 */

const CHART_WINDOW_SIZE = 10;


/*
 * How many past readings to ask the server
 * for when the CPU page loads. The server
 * is the source of truth now -- readings
 * live in logs/cpu/*.jsonl on disk, NOT in
 * the browser.
 */

const MAX_FETCHED_READINGS = 2000;


/* ==========================================================
   TIMER MANAGEMENT
========================================================== */

function clearCpuRefreshTimer() {

    if (cpuRefreshTimer !== null) {

        clearInterval(
            cpuRefreshTimer
        );

        cpuRefreshTimer = null;
    }
}


/* ==========================================================
   CHART CLEANUP
========================================================== */

function destroyCpuChart() {

    if (cpuChart !== null) {

        cpuChart.destroy();

        cpuChart = null;
    }


    /*
     * Reset the scrubber so returning to
     * this page always starts on "Live".
     */

    chartWindowStart = 0;

    followLive = true;
}


/* ==========================================================
   TEMPLATE RENDERING
========================================================== */

function renderTemplate(templateId) {

    const template =
        document.getElementById(
            templateId
        );

    if (!template) {

        console.error(
            "Template not found:",
            templateId
        );

        return;
    }


    const fragment =
        template.content.cloneNode(
            true
        );


    contentEl.replaceChildren(
        fragment
    );
}


/* ==========================================================
   MENU HIGHLIGHTING
========================================================== */

function highlightActiveMenuItem(button) {

    document
        .querySelectorAll(".menu-item")
        .forEach((item) => {

            item.classList.remove(
                "active"
            );

        });


    if (!button) {

        return;
    }


    /*
     * If CPU Usage or another System Health
     * submenu item is selected, highlight
     * System Health.
     */

    if (
        button.closest(
            "#health-menu"
        )
    ) {

        healthToggleBtn.classList.add(
            "active"
        );

    }

    else if (
        button.classList.contains(
            "menu-item"
        )
    ) {

        button.classList.add(
            "active"
        );
    }
}


/* ==========================================================
   DASHBOARD
========================================================== */

function renderDashboard() {

    clearCpuRefreshTimer();

    destroyCpuChart();

    renderTemplate(
        "template-dashboard"
    );
}


/* ==========================================================
   CPU PAGE
========================================================== */

async function renderCpuPage() {

    clearCpuRefreshTimer();

    destroyCpuChart();

    resetTimeRangeState();

    renderTemplate(
        "template-cpu"
    );


    /*
     * Load every previously logged reading
     * from the server (logs/cpu/*.jsonl)
     * before drawing anything.
     */

    await loadCpuHistoryFromServer();


    /*
     * Compute the initial filtered view
     * ("Live" = every reading) before the
     * chart is created.
     */

    filterReadingsByTime();


    /*
     * Display the existing history
     * immediately.
     */

    createCpuChart();


    /*
     * Wire up the history scrubber
     * (slider + Live button).
     */

    wireCpuChartScrubber();


    /*
     * Wire up the Time Range dropdown,
     * Refresh Interval select, Pause/Resume
     * button and the Custom Range modal.
     */

    wireTimeRangeControls();

    wireDateRangeControls();


    /*
     * Get the latest CPU value immediately.
     */

    loadCpuUsage();


    /*
     * Continue refreshing at the currently
     * selected interval, unless the user has
     * paused live monitoring.
     */

    if (!isPaused) {

        cpuRefreshTimer =
            setInterval(
                loadCpuUsage,
                refreshIntervalMs
            );
    }
}


/* ==========================================================
   DEVELOPMENT PAGE
========================================================== */

function renderDevelopmentPage(
    featureName
) {

    clearCpuRefreshTimer();

    destroyCpuChart();

    renderTemplate(
        "template-development"
    );


    const heading =
        contentEl.querySelector(
            '[data-role="feature-name"]'
        );


    if (heading) {

        heading.textContent =
            featureName ||
            "Feature";
    }
}


/* ==========================================================
   CPU API
========================================================== */

async function loadCpuUsage() {

    /*
     * Make sure we are currently
     * on the CPU page.
     */

    const valueEl =
        contentEl.querySelector(
            '[data-role="cpu-value"]'
        );


    const chartCanvas =
        contentEl.querySelector(
            '[data-role="cpu-chart"]'
        );


    if (
        !valueEl ||
        !chartCanvas
    ) {

        return;
    }


    try {

        /*
         * Call FastAPI.
         *
         * FastAPI then executes the
         * existing Linux Bash functionality.
         */

        const response =
            await fetch(
                "/api/cpu"
            );


        if (!response.ok) {

            throw new Error(
                `API request failed with status ${response.status}`
            );
        }


        const data =
            await response.json();


        /*
         * Convert the API result
         * into a JavaScript number.
         */

        const cpu =
            Number(
                data.cpu_usage
            );


        /*
         * Validate the received value.
         */

        if (
            !Number.isFinite(cpu)
        ) {

            throw new Error(
                "Invalid CPU value received from API"
            );
        }


        /*
         * Keep the value between
         * 0 and 100.
         */

        const safeCpu =
            Math.max(
                0,
                Math.min(
                    cpu,
                    100
                )
            );


        /*
         * Add a NEW reading.
         *
         * IMPORTANT:
         * Old readings are never removed.
         */

        addCpuReading(
            safeCpu,
            data.timestamp
        );


        /*
         * Re-apply the currently selected time
         * range (Live / 1h / 5h / 12h / Custom)
         * now that a new reading exists. This
         * keeps relative ranges ("Last 1 Hour")
         * sliding forward in real time without
         * ever discarding raw history.
         */

        filterReadingsByTime();


        /*
         * Update graph.
         */

        updateChart();


        /*
         * Update statistics cards.
         */

        updateKPIs();


    }

    catch (error) {

        console.error(
            "Failed to load CPU usage:",
            error
        );


        valueEl.textContent =
            "Error";


        updateCpuStatus(
            null
        );
    }
}


/* ==========================================================
   ADD CPU READING
========================================================== */

function addCpuReading(cpu, timestamp) {

    /*
     * Store the CPU value together with
     * the exact time it was received.
     *
     * The server already wrote this same
     * reading to logs/cpu/*.jsonl when we
     * called /api/cpu, so nothing needs to
     * be saved from the browser here.
     *
     * NOTHING IS DELETED from this
     * in-memory list either.
     */

    cpuHistory.push({

        value:
            cpu,

        time:
            timestamp
                ? new Date(timestamp)
                : new Date()

    });
}


/* ==========================================================
   CPU HISTORY (SERVER-BACKED)

   Readings live on disk on the server
   (logs/cpu/*.jsonl), not in the browser.
   This restores them whenever the CPU
   page is opened -- including after a
   refresh, a server restart, or from a
   completely different browser.
========================================================== */

async function loadCpuHistoryFromServer() {

    try {

        const response =
            await fetch(
                "/api/cpu/history?limit=" +
                MAX_FETCHED_READINGS
            );

        if (!response.ok) {

            throw new Error(
                `History request failed with status ${response.status}`
            );
        }


        const data =
            await response.json();

        const readings =
            Array.isArray(data.readings)
                ? data.readings
                : [];

        cpuHistory =
            readings
                .map(
                    item => ({

                        value:
                            Number(item.cpu_usage),

                        time:
                            new Date(item.timestamp)

                    })
                )
                .filter(
                    item =>
                        Number.isFinite(item.value) &&
                        !isNaN(item.time.getTime())
                );
    }

    catch (error) {

        console.warn(
            "Could not load CPU history from server:",
            error
        );

        cpuHistory = [];
    }
}


/* ==========================================================
   CPU STATUS
========================================================== */

function getCpuStatus(cpu) {

    if (
        cpu === null ||
        cpu === undefined
    ) {

        return {
            label: "Unavailable",
            className: "status-unavailable"
        };
    }


    if (
        cpu >= CRITICAL_THRESHOLD
    ) {

        return {
            label: "Critical",
            className: "status-critical"
        };
    }


    if (
        cpu >= WARNING_THRESHOLD
    ) {

        return {
            label: "Warning",
            className: "status-warning"
        };
    }


    return {
        label: "Normal",
        className: "status-normal"
    };
}


/* ==========================================================
   UPDATE CPU STATUS
========================================================== */

function updateCpuStatus(cpu) {

    const statusEl =
        contentEl.querySelector(
            '[data-role="cpu-status"]'
        );


    if (!statusEl) {

        return;
    }


    const status =
        getCpuStatus(cpu);


    statusEl.textContent =
        status.label;


    statusEl.className =
        "cpu-status " +
        status.className;
}


/* ==========================================================
   TIME FORMAT
========================================================== */

function formatTime(date) {

    return date.toLocaleTimeString(
        [],
        {
            hour:
                "2-digit",

            minute:
                "2-digit",

            second:
                "2-digit"
        }
    );
}


/* ==========================================================
   TOOLTIP TIME FORMAT
========================================================== */

function formatTooltipTime(date) {

    return formatDateTimeLabel(date);
}


/* ==========================================================
   TWELVE-HOUR TIME (HH:MM AM/PM, no seconds)

   Used for every time-picker input field so the text always
   matches parseTwelveHourTime()'s expected format.
========================================================== */

function formatTwelveHourTime(date) {

    return date.toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}


/* ==========================================================
   FULL DATE + TIME LABEL

   Example: "27 Aug 2026, 08:45 AM" -- used by tooltips, the
   applied range summary, and the Peak/Minimum KPI timestamps
   so every part of the UI reports dates the same way.
========================================================== */

function formatDateTimeLabel(date) {

    const datePart =
        date.toLocaleDateString(
            "en-GB",
            {
                day: "numeric",
                month: "short",
                year: "numeric"
            }
        );

    return datePart + ", " + formatTwelveHourTime(date);
}


/* ==========================================================
   DURATION LABEL

   Example: 3 days 2 hours 30 minutes.
========================================================== */

function formatDurationLabel(durationMs) {

    if (!Number.isFinite(durationMs) || durationMs <= 0) {

        return "0 minutes";
    }

    const totalMinutes =
        Math.round(durationMs / 60000);

    const days =
        Math.floor(totalMinutes / 1440);

    const hours =
        Math.floor((totalMinutes % 1440) / 60);

    const minutes =
        totalMinutes % 60;

    const parts = [];

    if (days > 0) {

        parts.push(days + " day" + (days === 1 ? "" : "s"));
    }

    if (hours > 0) {

        parts.push(hours + " hour" + (hours === 1 ? "" : "s"));
    }

    if (minutes > 0 || parts.length === 0) {

        parts.push(minutes + " minute" + (minutes === 1 ? "" : "s"));
    }

    return parts.join(" ");
}


/* ==========================================================
   CHART WIDTH
========================================================== */

function resizeChartCanvas(
    canvas
) {

    /*
     * The graph is responsive now: Chart.js
     * resizes the canvas to fill its container
     * automatically, so no manual width/height
     * calculation is needed here anymore.
     *
     * Kept as a no-op so existing call sites
     * do not need to change.
     */

    return;
}


/* ==========================================================
   CHART WINDOW
========================================================== */

function getMaxChartWindowStart() {

    return Math.max(
        0,
        chartDisplayReadings.length -
        CHART_WINDOW_SIZE
    );
}


function getChartWindow() {

    const maxStart =
        getMaxChartWindowStart();


    if (followLive) {

        chartWindowStart =
            maxStart;
    }

    else if (
        chartWindowStart >
        maxStart
    ) {

        chartWindowStart =
            maxStart;
    }


    return chartDisplayReadings.slice(
        chartWindowStart,
        chartWindowStart +
        CHART_WINDOW_SIZE
    );
}


/* ==========================================================
   CPU DATASET
========================================================== */

function createCpuDataset() {

    return {

        label:
            "CPU Utilization",


        data:
            getChartWindow().map(
                item =>
                    item.value
            ),


        borderWidth:
            3,


        pointRadius:
            3,


        pointHoverRadius:
            7,


        pointHitRadius:
            12,


        tension:
            0.25,


        fill:
            false,


        borderColor:
            "#10b981",


        backgroundColor:
            "rgba(16, 185, 129, 0.15)",


        pointBackgroundColor:
            "#0d1424",


        pointBorderColor:
            "#10b981",


        pointBorderWidth:
            2
    };
}


/* ==========================================================
   THRESHOLD DATASET
========================================================== */

function createThresholdDataset(
    value,
    label,
    color
) {

    return {

        label:
            label,


        data:
            getChartWindow().map(
                () => value
            ),


        borderColor:
            color,


        borderWidth:
            1.5,


        borderDash:
            [
                7,
                6
            ],


        pointRadius:
            0,


        pointHoverRadius:
            0,


        fill:
            false,


        tension:
            0
    };
}


/* ==========================================================
   CREATE CPU CHART
========================================================== */

function createCpuChart() {

    const canvas =
        contentEl.querySelector(
            '[data-role="cpu-chart"]'
        );


    if (!canvas) {

        return;
    }


    /*
     * Chart.js must exist.
     */

    if (
        typeof Chart ===
        "undefined"
    ) {

        console.error(
            "Chart.js is not loaded."
        );

        return;
    }


    /*
     * If an old chart exists,
     * destroy it first.
     */

    destroyCpuChart();


    /*
     * Set initial width.
     */

    resizeChartCanvas(
        canvas
    );


    const ctx =
        canvas.getContext(
            "2d"
        );


    cpuChart =
        new Chart(
            ctx,
            {

                type:
                    "line",


                data: {

                    labels:
                        getChartWindow().map(
                            item =>
                                formatTime(item.time)
                        ),


                    datasets: [

                        createCpuDataset(),


                        createThresholdDataset(
                            WARNING_THRESHOLD,
                            "Warning 50%",
                            "#f59e0b"
                        ),


                        createThresholdDataset(
                            CRITICAL_THRESHOLD,
                            "Critical 80%",
                            "#ef4444"
                        )

                    ]

                },


                options: {

                    responsive:
                        true,


                    maintainAspectRatio:
                        false,


                    interaction: {

                        mode:
                            "nearest",

                        intersect:
                            false

                    },


                    plugins: {

                        legend: {

                            display:
                                false

                        },


                        tooltip: {

                            enabled:
                                true,


                            backgroundColor:
                                "#0f172a",


                            titleColor:
                                "#f8fafc",


                            bodyColor:
                                "#f8fafc",


                            borderColor:
                                "rgba(16, 185, 129, 0.3)",


                            borderWidth:
                                1,


                            padding:
                                12,


                            displayColors:
                                false,

                            filter:
                                function (
                                    tooltipItem
                                ) {
                                    return tooltipItem.datasetIndex === 0;
                                },


                            callbacks: {

                                title:
                                    function (
                                        tooltipItems
                                    ) {

                                        const index =
                                            tooltipItems[0]
                                                .dataIndex;


                                        const point =
                                            getChartWindow()[index];


                                        if (
                                            !point
                                        ) {

                                            return "";
                                        }


                                        return formatTooltipTime(
                                            point.time
                                        );
                                    },


                                label:
                                    function (
                                        context
                                    ) {

                                        const index =
                                            context.dataIndex;


                                        const point =
                                            getChartWindow()[index];


                                        if (
                                            !point
                                        ) {

                                            return "";
                                        }


                                        /*
                                         * For the actual
                                         * CPU dataset show
                                         * the exact value.
                                         */

                                        if (
                                            context.dataset
                                                .label ===
                                            "CPU Utilization"
                                        ) {

                                            const valueLine =
                                                (point.aggregated
                                                    ? "Avg CPU Utilization: "
                                                    : "CPU Utilization: ") +
                                                point.value.toFixed(1) +
                                                "%";

                                            const statusLine =
                                                "Status: " +
                                                getCpuStatus(point.value).label;

                                            return [
                                                valueLine,
                                                statusLine
                                            ];
                                        }


                                        return (
                                            context.dataset.label +
                                            ": " +
                                            context.parsed.y +
                                            "%"
                                        );
                                    }

                            }

                        }

                    },


                    scales: {

                        x: {

                            type:
                                "category",


                            grid: {

                                color:
                                    "#1e293b",


                                lineWidth:
                                    1
                            },


                            border: {

                                display:
                                    false
                            },


                            ticks: {

                                color:
                                    "#94a3b8",


                                autoSkip:
                                    true,


                                autoSkipPadding:
                                    20,


                                maxTicksLimit:
                                    8,


                                maxRotation:
                                    0,


                                minRotation:
                                    0,


                                padding:
                                    8,


                                font: {

                                    size:
                                        11,

                                    family:
                                        "'JetBrains Mono', monospace"
                                },


                                callback:
                                    function (
                                        value,
                                        index
                                    ) {

                                        return this.getLabelForValue
                                            ? this.getLabelForValue(value)
                                            : value;
                                    }

                            }

                        },


                        y: {

                            min:
                                0,


                            max:
                                100,


                            grid: {

                                color:
                                    "#1e293b",


                                lineWidth:
                                    1
                            },


                            border: {

                                display:
                                    false
                            },


                            ticks: {

                                stepSize:
                                    20,


                                color:
                                    "#94a3b8",


                                padding:
                                    10,


                                font: {

                                    family:
                                        "'JetBrains Mono', monospace"
                                },


                                callback:
                                    function (
                                        value
                                    ) {

                                        return (
                                            value +
                                            "%"
                                        );
                                    }

                            }

                        }

                    }

                }

            }
        );


    updateChartScrollbarUI();
}


/* ==========================================================
   UPDATE CPU CHART
========================================================== */

function updateCpuChart() {

    const canvas =
        contentEl.querySelector(
            '[data-role="cpu-chart"]'
        );


    if (!canvas) {

        return;
    }


    /*
     * If chart doesn't exist,
     * create it.
     */

    if (!cpuChart) {

        createCpuChart();

        return;
    }


    /*
     * Make graph wider as history grows.
     */

    resizeChartCanvas(
        canvas
    );


    /*
     * Redraw with whatever window
     * (live or scrolled-back) is
     * currently active.
     */

    renderChartWindow();


    updateChartScrollbarUI();
}


/* ==========================================================
   CHART SCRUBBER (STOCK-STYLE RANGE SCROLLBAR)
========================================================== */

let isDraggingThumb = false;
let dragStartX = 0;
let dragStartWindowIndex = 0;

function updateChartScrubberLabel(
    windowPoints
) {

    const labelEl =
        contentEl.querySelector(
            '[data-role="cpu-scrubber-range"]'
        );

    if (!labelEl) {

        return;
    }


    if (
        !windowPoints ||
        windowPoints.length === 0
    ) {

        labelEl.textContent =
            cpuHistory.length === 0
                ? "No data yet"
                : "No CPU readings available for the selected time range.";

        return;
    }


    const first =
        windowPoints[0].time;

    const last =
        windowPoints[
            windowPoints.length - 1
        ].time;

    labelEl.textContent =
        formatTime(first) +
        " – " +
        formatTime(last) +
        " (" +
        filteredReadings.length +
        " reading" +
        (filteredReadings.length === 1 ? "" : "s") +
        " in range)";
}


function renderChartWindow() {

    if (!cpuChart) {

        return;
    }


    const windowPoints =
        getChartWindow();


    const emptyStateEl =
        contentEl.querySelector(
            '[data-role="chart-empty-state"]'
        );

    const canvasEl =
        contentEl.querySelector(
            '[data-role="cpu-chart"]'
        );

    const hasRangeData =
        filteredReadings.length > 0;

    if (emptyStateEl) {

        emptyStateEl.hidden =
            hasRangeData;
    }

    if (canvasEl) {

        canvasEl.style.visibility =
            hasRangeData
                ? "visible"
                : "hidden";
    }


    cpuChart.data.labels =
        windowPoints.map(
            item =>
                formatTime(item.time)
        );

    cpuChart.data.datasets[0].data =
        windowPoints.map(
            item =>
                item.value
        );

    cpuChart.data.datasets[1].data =
        windowPoints.map(
            () =>
                WARNING_THRESHOLD
        );

    cpuChart.data.datasets[2].data =
        windowPoints.map(
            () =>
                CRITICAL_THRESHOLD
        );

    cpuChart.update(
        "none"
    );

    updateChartScrubberLabel(
        windowPoints
    );
}


function updateChartScrollbarUI() {

    const thumbEl =
        contentEl.querySelector(
            '[data-role="stock-scrollbar-thumb"]'
        );

    const trackEl =
        contentEl.querySelector(
            '[data-role="stock-scrollbar-track"]'
        );

    const liveBtn =
        contentEl.querySelector(
            '[data-role="cpu-live-btn"]'
        );

    const totalReadings =
        cpuHistory.length;

    const maxStart =
        getMaxChartWindowStart();


    if (thumbEl && trackEl) {

        if (totalReadings <= CHART_WINDOW_SIZE) {

            thumbEl.style.width = "100%";

            thumbEl.style.left = "0%";

        } else {

            const ratio =
                CHART_WINDOW_SIZE / totalReadings;

            const thumbWidthPercent =
                Math.max(8, Math.min(100, ratio * 100));

            const maxThumbLeftPercent =
                100 - thumbWidthPercent;

            let currentStart =
                followLive
                    ? maxStart
                    : Math.min(chartWindowStart, maxStart);

            chartWindowStart = currentStart;

            const fraction =
                maxStart > 0
                    ? currentStart / maxStart
                    : 1;

            const thumbLeftPercent =
                fraction * maxThumbLeftPercent;

            thumbEl.style.width =
                thumbWidthPercent + "%";

            thumbEl.style.left =
                thumbLeftPercent + "%";

        }

    }


    if (liveBtn) {

        liveBtn.classList.toggle(
            "is-live",
            followLive
        );

    }


    updateChartScrubberLabel(
        getChartWindow()
    );
}


function goToLiveChartView() {

    followLive = true;

    chartWindowStart =
        getMaxChartWindowStart();

    renderChartWindow();

    updateChartScrollbarUI();
}


function wireCpuChartScrubber() {

    const thumbEl =
        contentEl.querySelector(
            '[data-role="stock-scrollbar-thumb"]'
        );

    const trackEl =
        contentEl.querySelector(
            '[data-role="stock-scrollbar-track"]'
        );

    const leftBtn =
        contentEl.querySelector(
            '[data-role="scroll-left-btn"]'
        );

    const rightBtn =
        contentEl.querySelector(
            '[data-role="scroll-right-btn"]'
        );

    const liveBtn =
        contentEl.querySelector(
            '[data-role="cpu-live-btn"]'
        );

    const chartContainer =
        contentEl.querySelector(
            ".cpu-chart-container"
        );


    function startDrag(clientX) {

        isDraggingThumb = true;

        dragStartX = clientX;

        dragStartWindowIndex = chartWindowStart;

        if (thumbEl) {

            thumbEl.classList.add("is-dragging");

        }

    }


    function onPointerMove(clientX) {

        if (!isDraggingThumb || !trackEl || !thumbEl) {

            return;

        }

        const dx = clientX - dragStartX;

        const trackWidth = trackEl.clientWidth;

        const thumbWidth = thumbEl.clientWidth;

        const usableWidth = trackWidth - thumbWidth;

        if (usableWidth <= 0) {

            return;

        }


        const deltaFraction = dx / usableWidth;

        const maxStart = getMaxChartWindowStart();

        let newStart = Math.round(dragStartWindowIndex + deltaFraction * maxStart);

        newStart = Math.max(0, Math.min(newStart, maxStart));


        chartWindowStart = newStart;

        followLive = (chartWindowStart >= maxStart);


        renderChartWindow();

        updateChartScrollbarUI();

    }


    function endDrag() {

        if (isDraggingThumb) {

            isDraggingThumb = false;

            if (thumbEl) {

                thumbEl.classList.remove("is-dragging");

            }

        }

    }


    if (thumbEl) {

        thumbEl.addEventListener("mousedown", (e) => {

            e.preventDefault();

            startDrag(e.clientX);

        });


        thumbEl.addEventListener("touchstart", (e) => {

            if (e.touches && e.touches.length === 1) {

                startDrag(e.touches[0].clientX);

            }

        }, { passive: true });

    }


    window.addEventListener("mousemove", (e) => {

        if (isDraggingThumb) {

            onPointerMove(e.clientX);

        }

    });


    window.addEventListener("touchmove", (e) => {

        if (isDraggingThumb && e.touches && e.touches.length === 1) {

            onPointerMove(e.touches[0].clientX);

        }

    }, { passive: true });


    window.addEventListener("mouseup", endDrag);

    window.addEventListener("touchend", endDrag);


    if (trackEl) {

        trackEl.addEventListener("click", (e) => {

            if (e.target === thumbEl) {

                return;

            }

            const rect = trackEl.getBoundingClientRect();

            const clickX = e.clientX - rect.left;

            const trackWidth = trackEl.clientWidth;

            const thumbWidth = thumbEl ? thumbEl.clientWidth : 0;

            const usableWidth = trackWidth - thumbWidth;

            if (usableWidth <= 0) {

                return;

            }


            const targetLeft = clickX - thumbWidth / 2;

            const fraction = Math.max(0, Math.min(1, targetLeft / usableWidth));

            const maxStart = getMaxChartWindowStart();


            chartWindowStart = Math.round(fraction * maxStart);

            followLive = (chartWindowStart >= maxStart);


            renderChartWindow();

            updateChartScrollbarUI();

        });

    }


    if (leftBtn) {

        leftBtn.addEventListener("click", () => {

            if (chartWindowStart > 0) {

                chartWindowStart--;

                followLive = false;

                renderChartWindow();

                updateChartScrollbarUI();

            }

        });

    }


    if (rightBtn) {

        rightBtn.addEventListener("click", () => {

            const maxStart = getMaxChartWindowStart();

            if (chartWindowStart < maxStart) {

                chartWindowStart++;

                followLive = (chartWindowStart >= maxStart);

                renderChartWindow();

                updateChartScrollbarUI();

            }

        });

    }


    function onWheelScroll(e) {

        /*
         * ONLY horizontal scrolling (e.deltaX) moves the chart scrollbar.
         * Ignore vertical top-to-bottom page scrolling (e.deltaY) completely
         * so the page scrolls up and down normally.
         */

        if (Math.abs(e.deltaX) < 2) {

            return;

        }


        const maxStart = getMaxChartWindowStart();

        if (e.deltaX > 0 && chartWindowStart < maxStart) {

            e.preventDefault();

            chartWindowStart++;

            followLive = (chartWindowStart >= maxStart);

            renderChartWindow();

            updateChartScrollbarUI();

        } else if (e.deltaX < 0 && chartWindowStart > 0) {

            e.preventDefault();

            chartWindowStart--;

            followLive = false;

            renderChartWindow();

            updateChartScrollbarUI();

        }

    }


    if (chartContainer) {

        chartContainer.addEventListener("wheel", onWheelScroll, { passive: false });

    }


    if (trackEl) {

        trackEl.addEventListener("wheel", onWheelScroll, { passive: false });

    }


    if (liveBtn) {

        liveBtn.addEventListener("click", goToLiveChartView);

    }


    updateChartScrollbarUI();

}


/* ==========================================================
   CPU STATISTICS
========================================================== */

function updateCpuStatistics() {

    const currentEl =
        contentEl.querySelector(
            '[data-role="current-cpu"]'
        );

    const heroValueEl =
        contentEl.querySelector(
            '[data-role="cpu-value"]'
        );

    const heroLabelEl =
        contentEl.querySelector(
            '[data-role="cpu-value-label"]'
        );


    const readingsEl =
        contentEl.querySelector(
            '[data-role="reading-count"]'
        );


    const averageEl =
        contentEl.querySelector(
            '[data-role="average-cpu"]'
        );


    const peakEl =
        contentEl.querySelector(
            '[data-role="peak-cpu"]'
        );

    const peakTimeEl =
        contentEl.querySelector(
            '[data-role="peak-cpu-time"]'
        );

    const minimumEl =
        contentEl.querySelector(
            '[data-role="minimum-cpu"]'
        );

    const minimumTimeEl =
        contentEl.querySelector(
            '[data-role="minimum-cpu-time"]'
        );


    const readingsCount =
        filteredReadings.length;

    if (readingsEl) {

        readingsEl.textContent =
            String(readingsCount);
    }


    /*
     * No readings inside the selected range:
     * show a clean "--" placeholder instead
     * of NaN / undefined, and never crash.
     */

    if (readingsCount === 0) {

        if (currentEl) {

            currentEl.textContent = "--%";
        }

        if (averageEl) {

            averageEl.textContent = "--%";
        }

        if (peakEl) {

            peakEl.textContent = "--%";
        }

        if (peakTimeEl) {

            peakTimeEl.textContent = "";
        }

        if (minimumEl) {

            minimumEl.textContent = "--%";
        }

        if (minimumTimeEl) {

            minimumTimeEl.textContent = "";
        }

        if (heroValueEl) {

            heroValueEl.textContent = "--%";
        }

        if (heroLabelEl) {

            heroLabelEl.textContent =
                selectedTimeRange === "live"
                    ? "Current CPU Utilization"
                    : "Average CPU Utilization";
        }

        updateCpuStatus(null);

        return;
    }


    const values =
        filteredReadings.map(
            item =>
                item.value
        );


    const total =
        values.reduce(
            (
                sum,
                value
            ) =>
                sum + value,
            0
        );


    const average =
        total /
        values.length;


    /*
     * Peak / minimum are found together with the exact
     * reading that produced them, so their timestamps are
     * always accurate -- even once the CHART is aggregated,
     * these numbers come straight from raw filteredReadings.
     */

    let peakReading = filteredReadings[0];

    let minimumReading = filteredReadings[0];

    for (const reading of filteredReadings) {

        if (reading.value > peakReading.value) {

            peakReading = reading;
        }

        if (reading.value < minimumReading.value) {

            minimumReading = reading;
        }
    }


    const latest =
        filteredReadings[
            filteredReadings.length - 1
        ].value;


    if (currentEl) {

        currentEl.textContent =
            latest.toFixed(1) +
            "%";
    }

    const isLive =
        selectedTimeRange === "live";

    if (heroValueEl) {

        heroValueEl.textContent =
            (isLive ? latest : average).toFixed(1) +
            "%";
    }

    if (heroLabelEl) {

        heroLabelEl.textContent =
            isLive
                ? "Current CPU Utilization"
                : "Average CPU Utilization";
    }

    updateCpuStatus(isLive ? latest : average);


    if (averageEl) {

        averageEl.textContent =
            average.toFixed(
                1
            ) +
            "%";
    }


    if (peakEl) {

        peakEl.textContent =
            peakReading.value.toFixed(1) +
            "%";
    }

    if (peakTimeEl) {

        peakTimeEl.textContent =
            formatDateTimeLabel(peakReading.time);
    }

    if (minimumEl) {

        minimumEl.textContent =
            minimumReading.value.toFixed(1) +
            "%";
    }

    if (minimumTimeEl) {

        minimumTimeEl.textContent =
            formatDateTimeLabel(minimumReading.time);
    }
}


/* ==========================================================
   TIME RANGE FILTER MODULE
========================================================== */

/*
 * Human-readable label for every selectable range.
 */

const TIME_RANGE_LABELS = {

    live: "Live",

    "1h": "Last 1 Hour",

    "5h": "Last 5 Hours",

    "12h": "Last 12 Hours",

    custom: "Custom",

    "1d": "Last 1 Day",

    "3d": "Last 3 Days",

    "5d": "Last 5 Days",

    "custom-date": "Custom"
};


/*
 * How many milliseconds each relative range covers.
 * "live" and "custom" are handled separately.
 */

const TIME_RANGE_DURATIONS_MS = {

    "1h": 60 * 60 * 1000,

    "5h": 5 * 60 * 60 * 1000,

    "12h": 12 * 60 * 60 * 1000,

    "1d": 24 * 60 * 60 * 1000,

    "3d": 3 * 24 * 60 * 60 * 1000,

    "5d": 5 * 24 * 60 * 60 * 1000
};


/*
 * Which "family" a range key belongs to. Day-scale ranges get
 * chart aggregation and do NOT auto-follow the live edge once
 * applied (per spec: historical mode should not silently move
 * the scrollbar as new readings arrive).
 */

const DATE_SCALE_RANGE_KEYS = new Set([
    "1d",
    "3d",
    "5d",
    "custom-date"
]);


/* ----------------------------------------------------------
   RESET (called every time the CPU page is (re)loaded)
---------------------------------------------------------- */

function resetTimeRangeState() {

    selectedTimeRange = "live";

    customRangeStart = null;

    customRangeEnd = null;

    isPaused = false;

    refreshIntervalMs = CPU_REFRESH_INTERVAL_DEFAULT;

    filteredReadings = [];

    chartDisplayReadings = [];

    aggregationIntervalMs = 0;

    dtPicker = {

        from: {
            year: 0,
            month: 0,
            selectedDate: null
        },

        to: {
            year: 0,
            month: 0,
            selectedDate: null
        }
    };
}


/* ----------------------------------------------------------
   getTimeRange()

   Dynamically computes the {start, end} Date bounds for the
   currently selected range. Never hardcoded -- "now" is
   always read fresh.
---------------------------------------------------------- */

function getTimeRange() {

    if (selectedTimeRange === "live") {

        return {
            start: null,
            end: null
        };
    }


    if (selectedTimeRange === "custom" || selectedTimeRange === "custom-date") {

        return {
            start: customRangeStart,
            end: customRangeEnd
        };
    }


    const durationMs =
        TIME_RANGE_DURATIONS_MS[selectedTimeRange];

    const end = new Date();

    const start =
        new Date(end.getTime() - durationMs);

    return {
        start,
        end
    };
}


/* ----------------------------------------------------------
   filterReadingsByTime()

   Filters cpuHistory (the full, never-deleted dataset) down
   to filteredReadings -- the readings that belong to the
   currently selected time range. This is the ONLY array the
   chart, KPIs and scrollbar ever read from.
---------------------------------------------------------- */

function filterReadingsByTime() {

    const range =
        getTimeRange();


    if (range.start === null || range.end === null) {

        /*
         * "Live" (or an incomplete custom range):
         * every collected reading is in view.
         */

        filteredReadings =
            cpuHistory.slice();

        computeChartDisplayReadings();

        return filteredReadings;
    }


    filteredReadings =
        cpuHistory.filter(
            (reading) =>
                reading.time.getTime() >= range.start.getTime() &&
                reading.time.getTime() <= range.end.getTime()
        );

    computeChartDisplayReadings();

    return filteredReadings;
}


/* ----------------------------------------------------------
   getAggregationIntervalMs()

   Chooses a sensible bucket size for the CHART based on how
   much time the currently selected range spans. KPIs never
   use this -- they always read the raw filteredReadings.
---------------------------------------------------------- */

function getAggregationIntervalMs() {

    if (!DATE_SCALE_RANGE_KEYS.has(selectedTimeRange)) {

        /*
         * Live / 1h / 5h / 12h already fit comfortably in the
         * existing windowed chart -- no aggregation needed.
         */

        return 0;
    }

    const range =
        getTimeRange();

    if (!range.start || !range.end) {

        return 0;
    }

    const spanMs =
        range.end.getTime() - range.start.getTime();

    const ONE_HOUR = 60 * 60 * 1000;

    const ONE_DAY = 24 * ONE_HOUR;

    if (spanMs <= ONE_HOUR) {

        return 0;
    }

    if (spanMs <= ONE_DAY) {

        return 60 * 1000;
    }

    if (spanMs <= 3 * ONE_DAY) {

        return 60 * 1000;
    }

    if (spanMs <= 7 * ONE_DAY) {

        return 15 * 60 * 1000;
    }

    return 60 * 60 * 1000;
}


/* ----------------------------------------------------------
   aggregateReadings(readings, bucketMs)

   Downsamples readings into fixed-size time buckets, each
   represented by its average value and its start time. Raw
   readings are never modified -- this only affects what the
   CHART renders.
---------------------------------------------------------- */

function aggregateReadings(readings, bucketMs) {

    if (!readings.length || bucketMs <= 0) {

        return readings.slice();
    }

    const buckets = new Map();

    for (const reading of readings) {

        const bucketStart =
            Math.floor(reading.time.getTime() / bucketMs) * bucketMs;

        if (!buckets.has(bucketStart)) {

            buckets.set(bucketStart, {
                sum: 0,
                count: 0
            });
        }

        const bucket =
            buckets.get(bucketStart);

        bucket.sum += reading.value;

        bucket.count += 1;
    }

    const bucketStarts =
        Array.from(buckets.keys()).sort(
            (a, b) => a - b
        );

    return bucketStarts.map((bucketStart) => {

        const bucket =
            buckets.get(bucketStart);

        return {
            value: bucket.sum / bucket.count,
            time: new Date(bucketStart),
            aggregated: true,
            sampleCount: bucket.count
        };
    });
}


/* ----------------------------------------------------------
   computeChartDisplayReadings()

   Rebuilds chartDisplayReadings (raw or aggregated) from the
   current filteredReadings, and keeps the "(1 Minute
   Interval)" style label near the chart in sync.
---------------------------------------------------------- */

function computeChartDisplayReadings() {

    aggregationIntervalMs =
        getAggregationIntervalMs();

    chartDisplayReadings =
        aggregationIntervalMs > 0
            ? aggregateReadings(filteredReadings, aggregationIntervalMs)
            : filteredReadings.slice();

    updateResolutionLabel();

    return chartDisplayReadings;
}


/* ----------------------------------------------------------
   updateResolutionLabel()

   "CPU Utilization History (1 Minute Interval)" -- shows the
   viewer exactly what resolution they are looking at.
---------------------------------------------------------- */

function updateResolutionLabel() {

    const labelEl =
        contentEl.querySelector(
            '[data-role="chart-resolution-label"]'
        );

    if (!labelEl) {

        return;
    }

    if (aggregationIntervalMs <= 0) {

        labelEl.textContent =
            selectedTimeRange === "live"
                ? "Live monitoring • " + Math.round(refreshIntervalMs / 1000) + " second interval"
                : "Every reading • no aggregation";

        return;
    }

    const minutes =
        aggregationIntervalMs / 60000;

    let intervalText;

    if (minutes < 60) {

        intervalText =
            minutes + " Minute" + (minutes === 1 ? "" : "s") + " Interval";

    } else {

        const hours = minutes / 60;

        intervalText =
            hours + " Hour" + (hours === 1 ? "" : "s") + " Interval";
    }

    labelEl.textContent =
        "Aggregated • (" + intervalText + ")";
}


/* ----------------------------------------------------------
   updateChart() / updateKPIs() / updateRangeNavigator() /
   updateRangeSummary()

   Thin, clearly-named wrappers around the existing render
   pipeline so every part of the UI can be refreshed the same
   way after any range change.
---------------------------------------------------------- */

function updateChart() {

    updateCpuChart();
}


function updateKPIs() {

    updateCpuStatistics();
}


function updateRangeNavigator() {

    updateChartScrollbarUI();
}


function updateRangeSummary() {

    updateChartScrubberLabel(
        getChartWindow()
    );
}


/* ----------------------------------------------------------
   setLiveMode() / pauseLive() / resumeLive()

   setLiveMode() controls whether the CHART follows the
   newest reading (the existing "auto-scroll" behaviour).
   pauseLive()/resumeLive() control whether new readings are
   being COLLECTED at all -- a separate, real pause of live
   monitoring, not just a view change.
---------------------------------------------------------- */

function setLiveMode(isLive) {

    followLive = Boolean(isLive);

    if (followLive) {

        chartWindowStart =
            getMaxChartWindowStart();
    }

    renderChartWindow();

    updateRangeNavigator();
}


function pauseLive() {

    if (isPaused) {

        return;
    }

    isPaused = true;

    clearCpuRefreshTimer();

    updateLivePauseButtonUI();
}


function resumeLive() {

    if (!isPaused) {

        return;
    }

    isPaused = false;

    /*
     * Pick up any missed reading immediately,
     * then continue on the configured interval.
     */

    loadCpuUsage();

    clearCpuRefreshTimer();

    cpuRefreshTimer =
        setInterval(
            loadCpuUsage,
            refreshIntervalMs
        );

    updateLivePauseButtonUI();
}


function updateLivePauseButtonUI() {

    const btn =
        contentEl.querySelector(
            '[data-role="live-pause-btn"]'
        );

    const labelEl =
        contentEl.querySelector(
            '[data-role="live-pause-label"]'
        );

    if (!btn || !labelEl) {

        return;
    }

    btn.setAttribute(
        "aria-pressed",
        isPaused ? "true" : "false"
    );

    labelEl.textContent =
        isPaused ? "Resume Live" : "Pause Live";
}


/* ----------------------------------------------------------
   applyTimeRange(rangeKey)

   Applies a non-custom range selection (or opens the custom
   picker) and refreshes every dependent piece of UI.
---------------------------------------------------------- */

function applyTimeRangeCore() {

    filterReadingsByTime();

    /*
     * Day-scale (Date Range) selections start positioned at
     * the newest available data, but do NOT keep auto-following
     * as more readings arrive -- the user's chosen historical
     * window should stay put until they act again.
     */

    followLive = !DATE_SCALE_RANGE_KEYS.has(selectedTimeRange);

    chartWindowStart =
        getMaxChartWindowStart();

    updateChart();

    updateKPIs();

    updateRangeNavigator();

    updateRangeSummary();

    updateAppliedRangeSummaryBar();

    updateTimeRangeDropdownUI();
}


/* ----------------------------------------------------------
   updateAppliedRangeSummaryBar()

   Shows the exact currently-applied range and its total
   duration, e.g. "26 Aug 2026, 08:30 AM – 29 Aug 2026, 11:00 AM"
   plus "3 days 2 hours 30 minutes".
---------------------------------------------------------- */

function updateAppliedRangeSummaryBar() {

    const barEl =
        contentEl.querySelector(
            '[data-role="range-summary-bar"]'
        );

    const textEl =
        contentEl.querySelector(
            '[data-role="range-summary-text"]'
        );

    const durationEl =
        contentEl.querySelector(
            '[data-role="range-summary-duration"]'
        );

    if (!barEl || !textEl || !durationEl) {

        return;
    }

    if (selectedTimeRange === "live") {

        barEl.hidden = true;

        return;
    }

    const range =
        getTimeRange();

    if (!range.start || !range.end) {

        barEl.hidden = true;

        return;
    }

    barEl.hidden = false;

    textEl.textContent =
        formatDateTimeLabel(range.start) +
        "  —  " +
        formatDateTimeLabel(range.end);

    durationEl.textContent =
        formatDurationLabel(range.end.getTime() - range.start.getTime());
}


function applyTimeRange(rangeKey) {

    if (rangeKey === "custom") {

        openCustomRangeModal();

        return;
    }


    selectedTimeRange = rangeKey;

    customRangeStart = null;

    customRangeEnd = null;

    applyTimeRangeCore();

    closeTimeRangeMenu();
}


/* ----------------------------------------------------------
   Custom range: parsing, validation, apply
---------------------------------------------------------- */

function parseTwelveHourTime(rawValue) {

    if (typeof rawValue !== "string") {

        return null;
    }

    const match =
        rawValue
            .trim()
            .match(/^(\d{1,2}):(\d{2})\s*([APap][Mm])$/);

    if (!match) {

        return null;
    }

    let hours = Number(match[1]);

    const minutes = Number(match[2]);

    const meridiem = match[3].toUpperCase();

    if (
        hours < 1 || hours > 12 ||
        minutes < 0 || minutes > 59
    ) {

        return null;
    }

    if (meridiem === "AM") {

        hours = (hours === 12) ? 0 : hours;

    } else {

        hours = (hours === 12) ? 12 : hours + 12;
    }

    return {
        hours,
        minutes
    };
}


function validateCustomTime(fromStr, toStr) {

    const fromRaw =
        (fromStr || "").trim();

    const toRaw =
        (toStr || "").trim();

    if (!fromRaw || !toRaw) {

        return {
            valid: false,
            message: "Both From and To times are required."
        };
    }

    const fromParsed =
        parseTwelveHourTime(fromRaw);

    const toParsed =
        parseTwelveHourTime(toRaw);

    if (!fromParsed || !toParsed) {

        return {
            valid: false,
            message: "Enter times as HH:MM AM/PM, for example 08:30 AM."
        };
    }

    const now = new Date();

    const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        fromParsed.hours,
        fromParsed.minutes,
        0,
        0
    );

    const end = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        toParsed.hours,
        toParsed.minutes,
        0,
        0
    );

    if (start.getTime() === end.getTime()) {

        return {
            valid: false,
            message: "Start and end time cannot be the same."
        };
    }

    if (start.getTime() > end.getTime()) {

        return {
            valid: false,
            message: "Start time must be before end time."
        };
    }

    if (end.getTime() > now.getTime()) {

        return {
            valid: false,
            message: "End time cannot be in the future."
        };
    }

    return {
        valid: true,
        start,
        end
    };
}


function applyCustomTimeRange(fromStr, toStr) {

    const result =
        validateCustomTime(fromStr, toStr);

    if (!result.valid) {

        showCustomRangeError(result.message);

        return false;
    }

    customRangeStart = result.start;

    customRangeEnd = result.end;

    selectedTimeRange = "custom";

    applyTimeRangeCore();

    closeCustomRangeModal();

    closeTimeRangeMenu();

    return true;
}


/* ----------------------------------------------------------
   Time Range dropdown + Custom modal wiring
---------------------------------------------------------- */

function getActiveRangeLabel() {

    const isCustom =
        (selectedTimeRange === "custom" || selectedTimeRange === "custom-date") &&
        customRangeStart &&
        customRangeEnd;

    if (isCustom) {

        return (
            "Custom (" +
            formatTwelveHourTime(customRangeStart) +
            " – " +
            formatTwelveHourTime(customRangeEnd) +
            ")"
        );
    }

    return TIME_RANGE_LABELS[selectedTimeRange] || "Live";
}


/*
 * The Time Range and Date Range dropdowns are two independent
 * controls that happen to share the same underlying state. Each
 * one must only reflect its OWN family of options -- picking
 * "Last 1 Hour" in Time Range must not make Date Range claim
 * "Last 1 Hour" too, and vice versa. Whichever family is not
 * currently selected simply shows "Live".
 */

function updateTimeRangeDropdownUI() {

    const activeLabel =
        getActiveRangeLabel();

    const isDateScale =
        DATE_SCALE_RANGE_KEYS.has(selectedTimeRange);

    const triggerLabelEl =
        contentEl.querySelector(
            '[data-role="time-range-trigger-label"]'
        );

    const dateTriggerLabelEl =
        contentEl.querySelector(
            '[data-role="date-range-trigger-label"]'
        );

    if (triggerLabelEl) {

        triggerLabelEl.textContent =
            isDateScale ? "Live" : activeLabel;
    }

    if (dateTriggerLabelEl) {

        dateTriggerLabelEl.textContent =
            isDateScale ? activeLabel : "Live";
    }


    contentEl
        .querySelectorAll(".dropdown-option")
        .forEach((option) => {

            const matchesTimeRange =
                option.dataset.range !== undefined &&
                option.dataset.range === selectedTimeRange;

            const matchesDateRange =
                option.dataset.dateRange !== undefined &&
                option.dataset.dateRange === selectedTimeRange;

            option.classList.toggle(
                "active",
                matchesTimeRange || matchesDateRange
            );
        });
}


function closeTimeRangeMenu() {

    const dropdownEl =
        contentEl.querySelector(
            '[data-role="time-range-dropdown"]'
        );

    const menuEl =
        contentEl.querySelector(
            '[data-role="time-range-menu"]'
        );

    const triggerEl =
        contentEl.querySelector(
            '[data-role="time-range-trigger"]'
        );

    if (dropdownEl) {

        dropdownEl.removeAttribute("data-open");
    }

    if (menuEl) {

        menuEl.hidden = true;
    }

    if (triggerEl) {

        triggerEl.setAttribute("aria-expanded", "false");
    }
}


function openCustomRangeModal() {

    const overlayEl =
        contentEl.querySelector(
            '[data-role="custom-range-overlay"]'
        );

    const fromInput =
        contentEl.querySelector(
            '[data-role="custom-from-input"]'
        );

    const toInput =
        contentEl.querySelector(
            '[data-role="custom-to-input"]'
        );

    if (!overlayEl) {

        return;
    }

    if (fromInput && customRangeStart) {

        fromInput.value =
            formatTwelveHourTime(customRangeStart);
    }

    if (toInput && customRangeEnd) {

        toInput.value =
            formatTwelveHourTime(customRangeEnd);
    }

    hideCustomRangeError();

    overlayEl.hidden = false;

    closeTimeRangeMenu();

    if (fromInput) {

        fromInput.focus();
    }
}


function closeCustomRangeModal() {

    const overlayEl =
        contentEl.querySelector(
            '[data-role="custom-range-overlay"]'
        );

    if (overlayEl) {

        overlayEl.hidden = true;
    }

    hideCustomRangeError();
}


function showCustomRangeError(message) {

    const errorEl =
        contentEl.querySelector(
            '[data-role="custom-range-error"]'
        );

    if (!errorEl) {

        return;
    }

    errorEl.textContent = message;

    errorEl.hidden = false;
}


function hideCustomRangeError() {

    const errorEl =
        contentEl.querySelector(
            '[data-role="custom-range-error"]'
        );

    if (!errorEl) {

        return;
    }

    errorEl.hidden = true;

    errorEl.textContent = "";
}


function wireTimeRangeControls() {

    const dropdownEl =
        contentEl.querySelector(
            '[data-role="time-range-dropdown"]'
        );

    const triggerEl =
        contentEl.querySelector(
            '[data-role="time-range-trigger"]'
        );

    const menuEl =
        contentEl.querySelector(
            '[data-role="time-range-menu"]'
        );

    const refreshSelectEl =
        contentEl.querySelector(
            '[data-role="refresh-interval-select"]'
        );

    const livePauseBtn =
        contentEl.querySelector(
            '[data-role="live-pause-btn"]'
        );

    const customCancelBtn =
        contentEl.querySelector(
            '[data-role="custom-range-cancel"]'
        );

    const customApplyBtn =
        contentEl.querySelector(
            '[data-role="custom-range-apply"]'
        );

    const customFromInput =
        contentEl.querySelector(
            '[data-role="custom-from-input"]'
        );

    const customToInput =
        contentEl.querySelector(
            '[data-role="custom-to-input"]'
        );

    const overlayEl =
        contentEl.querySelector(
            '[data-role="custom-range-overlay"]'
        );


    if (triggerEl && dropdownEl && menuEl) {

        triggerEl.addEventListener("click", (event) => {

            event.stopPropagation();

            const isOpen =
                dropdownEl.getAttribute("data-open") === "true";

            if (isOpen) {

                closeTimeRangeMenu();

            } else {

                dropdownEl.setAttribute("data-open", "true");

                menuEl.hidden = false;

                triggerEl.setAttribute("aria-expanded", "true");
            }
        });
    }


    if (menuEl) {

        menuEl.addEventListener("click", (event) => {

            const option =
                event.target.closest(".dropdown-option");

            if (!option) {

                return;
            }

            applyTimeRange(option.dataset.range);
        });
    }


    /*
     * Close the dropdown when clicking anywhere else on
     * the page, and support Escape to close either the
     * dropdown or the custom range modal.
     */

    document.addEventListener("click", (event) => {

        if (dropdownEl && !dropdownEl.contains(event.target)) {

            closeTimeRangeMenu();
        }
    });

    document.addEventListener("keydown", (event) => {

        if (event.key !== "Escape") {

            return;
        }

        closeTimeRangeMenu();

        if (overlayEl && !overlayEl.hidden) {

            closeCustomRangeModal();
        }
    });


    if (refreshSelectEl) {

        refreshSelectEl.value =
            String(refreshIntervalMs);

        refreshSelectEl.addEventListener("change", () => {

            refreshIntervalMs =
                Number(refreshSelectEl.value) ||
                CPU_REFRESH_INTERVAL_DEFAULT;

            if (!isPaused) {

                clearCpuRefreshTimer();

                cpuRefreshTimer =
                    setInterval(
                        loadCpuUsage,
                        refreshIntervalMs
                    );
            }
        });
    }


    if (livePauseBtn) {

        livePauseBtn.addEventListener("click", () => {

            if (isPaused) {

                resumeLive();

            } else {

                pauseLive();
            }
        });
    }


    if (customCancelBtn) {

        customCancelBtn.addEventListener("click", () => {

            closeCustomRangeModal();
        });
    }


    if (customApplyBtn && customFromInput && customToInput) {

        customApplyBtn.addEventListener("click", () => {

            applyCustomTimeRange(
                customFromInput.value,
                customToInput.value
            );
        });
    }


    updateTimeRangeDropdownUI();

    updateLivePauseButtonUI();
}


/* ==========================================================
   DATE RANGE DROPDOWN + CUSTOM DATE/TIME CALENDAR MODAL
========================================================== */

function closeDateRangeMenu() {

    const dropdownEl =
        contentEl.querySelector(
            '[data-role="date-range-dropdown"]'
        );

    const menuEl =
        contentEl.querySelector(
            '[data-role="date-range-menu"]'
        );

    const triggerEl =
        contentEl.querySelector(
            '[data-role="date-range-trigger"]'
        );

    if (dropdownEl) {

        dropdownEl.removeAttribute("data-open");
    }

    if (menuEl) {

        menuEl.hidden = true;
    }

    if (triggerEl) {

        triggerEl.setAttribute("aria-expanded", "false");
    }
}


function applyDateRange(rangeKey) {

    if (rangeKey === "custom-date") {

        openDateTimeRangeModal();

        return;
    }

    selectedTimeRange = rangeKey;

    customRangeStart = null;

    customRangeEnd = null;

    applyTimeRangeCore();

    closeDateRangeMenu();
}


/* ----------------------------------------------------------
   Custom Date + Time Range modal
---------------------------------------------------------- */

function showDtRangeError(message) {

    const errorEl =
        contentEl.querySelector(
            '[data-role="dt-range-error"]'
        );

    if (!errorEl) {

        return;
    }

    errorEl.textContent = message;

    errorEl.hidden = false;
}


function hideDtRangeError() {

    const errorEl =
        contentEl.querySelector(
            '[data-role="dt-range-error"]'
        );

    if (!errorEl) {

        return;
    }

    errorEl.hidden = true;

    errorEl.textContent = "";
}


function startOfDay(dateObj) {

    return new Date(
        dateObj.getFullYear(),
        dateObj.getMonth(),
        dateObj.getDate()
    );
}


function openDateTimeRangeModal() {

    const overlayEl =
        contentEl.querySelector(
            '[data-role="dt-range-overlay"]'
        );

    if (!overlayEl) {

        return;
    }

    const now = new Date();

    const defaultFrom =
        customRangeStart ||
        new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const defaultTo =
        customRangeEnd ||
        now;

    dtPicker.from.selectedDate = startOfDay(defaultFrom);

    dtPicker.from.year = defaultFrom.getFullYear();

    dtPicker.from.month = defaultFrom.getMonth();

    dtPicker.to.selectedDate = startOfDay(defaultTo);

    dtPicker.to.year = defaultTo.getFullYear();

    dtPicker.to.month = defaultTo.getMonth();

    const fromTimeInput =
        contentEl.querySelector(
            '[data-role="dt-from-time"]'
        );

    const toTimeInput =
        contentEl.querySelector(
            '[data-role="dt-to-time"]'
        );

    if (fromTimeInput) {

        fromTimeInput.value =
            formatTwelveHourTime(defaultFrom);
    }

    if (toTimeInput) {

        toTimeInput.value =
            formatTwelveHourTime(defaultTo);
    }

    hideDtRangeError();

    renderCalendar("from");

    renderCalendar("to");

    overlayEl.hidden = false;

    closeDateRangeMenu();
}


function closeDateTimeRangeModal() {

    const overlayEl =
        contentEl.querySelector(
            '[data-role="dt-range-overlay"]'
        );

    if (overlayEl) {

        overlayEl.hidden = true;
    }

    hideDtRangeError();
}


/* ----------------------------------------------------------
   renderCalendar(kind)

   Builds a full 6x7 day grid for dtPicker[kind].year/month.
   Month lengths, leap years, and starting weekday are all
   derived from native Date arithmetic -- never hardcoded.
---------------------------------------------------------- */

function renderCalendar(kind) {

    const state = dtPicker[kind];

    const gridEl =
        contentEl.querySelector(
            '[data-role="dt-cal-grid-' + kind + '"]'
        );

    const labelEl =
        contentEl.querySelector(
            '[data-role="dt-cal-label-' + kind + '"]'
        );

    if (!gridEl || !labelEl) {

        return;
    }

    const monthStart =
        new Date(state.year, state.month, 1);

    const daysInMonth =
        new Date(state.year, state.month + 1, 0).getDate();

    const daysInPrevMonth =
        new Date(state.year, state.month, 0).getDate();

    const firstWeekday =
        monthStart.getDay();

    labelEl.textContent =
        monthStart.toLocaleDateString(
            undefined,
            { month: "long", year: "numeric" }
        );

    const today =
        startOfDay(new Date());

    const otherState =
        dtPicker[kind === "from" ? "to" : "from"];

    const rangeStart =
        dtPicker.from.selectedDate;

    const rangeEnd =
        dtPicker.to.selectedDate;

    gridEl.innerHTML = "";

    const totalCells = 42;

    for (let i = 0; i < totalCells; i++) {

        const dayOffset =
            i - firstWeekday + 1;

        let cellYear = state.year;

        let cellMonth = state.month;

        let cellDay = dayOffset;

        let isOutside = false;

        if (dayOffset < 1) {

            isOutside = true;

            cellDay = daysInPrevMonth + dayOffset;

            cellMonth = state.month - 1;

            if (cellMonth < 0) {

                cellMonth = 11;

                cellYear = state.year - 1;
            }

        } else if (dayOffset > daysInMonth) {

            isOutside = true;

            cellDay = dayOffset - daysInMonth;

            cellMonth = state.month + 1;

            if (cellMonth > 11) {

                cellMonth = 0;

                cellYear = state.year + 1;
            }
        }

        const cellDate =
            new Date(cellYear, cellMonth, cellDay);

        const btn =
            document.createElement("button");

        btn.type = "button";

        btn.className = "dt-cal-day";

        btn.textContent = String(cellDay);

        if (isOutside) {

            btn.classList.add("dt-cal-outside");
        }

        if (cellDate.getTime() === today.getTime()) {

            btn.classList.add("dt-cal-today");
        }

        if (cellDate.getTime() > today.getTime()) {

            btn.classList.add("dt-cal-future");

            btn.disabled = true;
        }

        if (
            rangeStart &&
            rangeEnd &&
            cellDate.getTime() > rangeStart.getTime() &&
            cellDate.getTime() < rangeEnd.getTime()
        ) {

            btn.classList.add("dt-cal-in-range");
        }

        if (
            state.selectedDate &&
            cellDate.getTime() === state.selectedDate.getTime()
        ) {

            btn.classList.add("dt-cal-selected");
        }

        btn.addEventListener("click", () => {

            selectCalendarDay(kind, cellDate);
        });

        gridEl.appendChild(btn);
    }
}


function navCalendar(kind, delta) {

    const state = dtPicker[kind];

    let newMonth = state.month + delta;

    let newYear = state.year;

    if (newMonth < 0) {

        newMonth = 11;

        newYear -= 1;

    } else if (newMonth > 11) {

        newMonth = 0;

        newYear += 1;
    }

    state.month = newMonth;

    state.year = newYear;

    renderCalendar(kind);
}


function selectCalendarDay(kind, dateObj) {

    const today =
        startOfDay(new Date());

    if (dateObj.getTime() > today.getTime()) {

        return;
    }

    dtPicker[kind].selectedDate = dateObj;

    if (dateObj.getMonth() !== dtPicker[kind].month ||
        dateObj.getFullYear() !== dtPicker[kind].year) {

        dtPicker[kind].month = dateObj.getMonth();

        dtPicker[kind].year = dateObj.getFullYear();
    }

    renderCalendar("from");

    renderCalendar("to");

    hideDtRangeError();
}


/* ----------------------------------------------------------
   validateDateTimeRange() / applyDateTimeRange()
---------------------------------------------------------- */

function validateDateTimeRange() {

    const fromTimeInput =
        contentEl.querySelector(
            '[data-role="dt-from-time"]'
        );

    const toTimeInput =
        contentEl.querySelector(
            '[data-role="dt-to-time"]'
        );

    if (!dtPicker.from.selectedDate || !dtPicker.to.selectedDate) {

        return {
            valid: false,
            message: "Select both a start date and an end date."
        };
    }

    const fromTimeParsed =
        parseTwelveHourTime(fromTimeInput ? fromTimeInput.value : "");

    const toTimeParsed =
        parseTwelveHourTime(toTimeInput ? toTimeInput.value : "");

    if (!fromTimeParsed || !toTimeParsed) {

        return {
            valid: false,
            message: "Enter times as HH:MM AM/PM, for example 08:30 AM."
        };
    }

    const start = new Date(
        dtPicker.from.selectedDate.getFullYear(),
        dtPicker.from.selectedDate.getMonth(),
        dtPicker.from.selectedDate.getDate(),
        fromTimeParsed.hours,
        fromTimeParsed.minutes,
        0,
        0
    );

    const end = new Date(
        dtPicker.to.selectedDate.getFullYear(),
        dtPicker.to.selectedDate.getMonth(),
        dtPicker.to.selectedDate.getDate(),
        toTimeParsed.hours,
        toTimeParsed.minutes,
        0,
        0
    );

    if (start.getTime() === end.getTime()) {

        return {
            valid: false,
            message: "Start and end date/time cannot be the same."
        };
    }

    if (start.getTime() > end.getTime()) {

        return {
            valid: false,
            message: "Start date/time must be before end date/time."
        };
    }

    const now = new Date();

    if (end.getTime() > now.getTime()) {

        return {
            valid: false,
            message: "End date/time cannot be in the future."
        };
    }

    return {
        valid: true,
        start,
        end
    };
}


function applyDateTimeRange() {

    const result =
        validateDateTimeRange();

    if (!result.valid) {

        showDtRangeError(result.message);

        return false;
    }

    customRangeStart = result.start;

    customRangeEnd = result.end;

    selectedTimeRange = "custom-date";

    applyTimeRangeCore();

    closeDateTimeRangeModal();

    closeDateRangeMenu();

    return true;
}


/* ----------------------------------------------------------
   wireDateRangeControls()
---------------------------------------------------------- */

function wireDateRangeControls() {

    const dropdownEl =
        contentEl.querySelector(
            '[data-role="date-range-dropdown"]'
        );

    const triggerEl =
        contentEl.querySelector(
            '[data-role="date-range-trigger"]'
        );

    const menuEl =
        contentEl.querySelector(
            '[data-role="date-range-menu"]'
        );

    const overlayEl =
        contentEl.querySelector(
            '[data-role="dt-range-overlay"]'
        );

    const cancelBtn =
        contentEl.querySelector(
            '[data-role="dt-range-cancel"]'
        );

    const applyBtn =
        contentEl.querySelector(
            '[data-role="dt-range-apply"]'
        );


    if (triggerEl && dropdownEl && menuEl) {

        triggerEl.addEventListener("click", (event) => {

            event.stopPropagation();

            const isOpen =
                dropdownEl.getAttribute("data-open") === "true";

            closeTimeRangeMenu();

            if (isOpen) {

                closeDateRangeMenu();

            } else {

                dropdownEl.setAttribute("data-open", "true");

                menuEl.hidden = false;

                triggerEl.setAttribute("aria-expanded", "true");
            }
        });
    }


    if (menuEl) {

        menuEl.addEventListener("click", (event) => {

            const option =
                event.target.closest(".dropdown-option");

            if (!option) {

                return;
            }

            applyDateRange(option.dataset.dateRange);
        });
    }


    document.addEventListener("click", (event) => {

        if (dropdownEl && !dropdownEl.contains(event.target)) {

            closeDateRangeMenu();
        }
    });


    document.addEventListener("keydown", (event) => {

        if (event.key !== "Escape") {

            return;
        }

        closeDateRangeMenu();

        if (overlayEl && !overlayEl.hidden) {

            closeDateTimeRangeModal();
        }
    });


    ["from", "to"].forEach((kind) => {

        const prevBtn =
            contentEl.querySelector(
                '[data-role="dt-cal-prev-' + kind + '"]'
            );

        const nextBtn =
            contentEl.querySelector(
                '[data-role="dt-cal-next-' + kind + '"]'
            );

        if (prevBtn) {

            prevBtn.addEventListener("click", () => {

                navCalendar(kind, -1);
            });
        }

        if (nextBtn) {

            nextBtn.addEventListener("click", () => {

                navCalendar(kind, 1);
            });
        }
    });


    if (cancelBtn) {

        cancelBtn.addEventListener("click", () => {

            closeDateTimeRangeModal();
        });
    }


    if (applyBtn) {

        applyBtn.addEventListener("click", () => {

            applyDateTimeRange();
        });
    }
}


/* ==========================================================
   ROUTER
========================================================== */

function goToPage(
    page,
    feature
) {

    switch (page) {

        case "dashboard":

            renderDashboard();

            break;


        case "cpu":

            renderCpuPage();

            break;


        case "development":

            renderDevelopmentPage(
                feature
            );

            break;


        default:

            console.warn(
                `Unknown page requested: "${page}"`
            );
    }
}


/* ==========================================================
   HEALTH MENU
========================================================== */

if (healthToggleBtn) {

    healthToggleBtn.addEventListener(
        "click",
        () => {

            healthMenuEl.classList.toggle(
                "show"
            );

        }
    );
}


/* ==========================================================
   SIDEBAR EVENT DELEGATION
========================================================== */

if (sidebarEl) {

    sidebarEl.addEventListener(
        "click",
        (event) => {

            const button =
                event.target.closest(
                    "button[data-page]"
                );


            if (!button) {

                return;
            }


            highlightActiveMenuItem(
                button
            );


            goToPage(
                button.dataset.page,
                button.dataset.feature
            );

        }
    );
}


/* ==========================================================
   CONTENT EVENT DELEGATION
========================================================== */

if (contentEl) {

    contentEl.addEventListener(
        "click",
        (event) => {

            const target =
                event.target.closest(
                    "[data-page]"
                );


            if (!target) {

                return;
            }


            highlightActiveMenuItem(
                null
            );


            goToPage(
                target.dataset.page,
                target.dataset.feature
            );

        }
    );
}


/* ==========================================================
   INITIAL PAGE
========================================================== */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        renderDashboard();

    }
);
