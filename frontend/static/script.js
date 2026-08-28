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


/* ==========================================================
   CONSTANTS
========================================================== */

const CPU_REFRESH_INTERVAL = 5000;

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
     * Get the latest CPU value immediately.
     */

    loadCpuUsage();


    /*
     * Continue refreshing every 5 seconds.
     */

    cpuRefreshTimer =
        setInterval(
            loadCpuUsage,
            CPU_REFRESH_INTERVAL
        );
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
         * Update the large current value.
         */

        valueEl.textContent =
            safeCpu.toFixed(1) +
            "%";


        /*
         * Update current status.
         */

        updateCpuStatus(
            safeCpu
        );


        /*
         * Update graph.
         */

        updateCpuChart();


        /*
         * Update statistics cards.
         */

        updateCpuStatistics(
            safeCpu
        );


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
        cpuHistory.length -
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


    return cpuHistory.slice(
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
            "#2563eb",


        backgroundColor:
            "#2563eb",


        pointBackgroundColor:
            "#ffffff",


        pointBorderColor:
            "#2563eb",


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
                                item.time
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
                                "#111827",


                            titleColor:
                                "#ffffff",


                            bodyColor:
                                "#ffffff",


                            borderColor:
                                "#334155",


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

                                            return (
                                                "CPU Usage: " +
                                                point.value.toFixed(
                                                    1
                                                ) +
                                                "%"
                                            );
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
                                    "#edf0f4",


                                lineWidth:
                                    1
                            },


                            border: {

                                display:
                                    false
                            },


                            ticks: {

                                color:
                                    "#7f8b9d",


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
                                        10
                                },


                                callback:
                                    function (
                                        value,
                                        index
                                    ) {

                                        const point =
                                            getChartWindow()[index];


                                        if (
                                            !point
                                        ) {

                                            return "";
                                        }


                                        return formatTime(
                                            point.time
                                        );
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
                                    "#e9edf3",


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
                                    "#7f8b9d",


                                padding:
                                    10,


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
            "No data yet";

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
        cpuHistory.length +
        " readings total)";
}


function renderChartWindow() {

    if (!cpuChart) {

        return;
    }


    const windowPoints =
        getChartWindow();

    cpuChart.data.labels =
        windowPoints.map(
            item =>
                item.time
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

function updateCpuStatistics(
    currentCpu
) {

    const currentEl =
        contentEl.querySelector(
            '[data-role="current-cpu"]'
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


    if (currentEl) {

        currentEl.textContent =
            currentCpu.toFixed(1) +
            "%";
    }


    if (readingsEl) {

        readingsEl.textContent =
            cpuHistory.length;
    }


    if (cpuHistory.length > 0) {

        const values =
            cpuHistory.map(
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


        const peak =
            Math.max(
                ...values
            );


        if (averageEl) {

            averageEl.textContent =
                average.toFixed(
                    1
                ) +
                "%";
        }


        if (peakEl) {

            peakEl.textContent =
                peak.toFixed(
                    1
                ) +
                "%";
        }
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
