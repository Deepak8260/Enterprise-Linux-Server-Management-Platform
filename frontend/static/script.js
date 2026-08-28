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

function renderCpuPage() {

    clearCpuRefreshTimer();

    destroyCpuChart();

    renderTemplate(
        "template-cpu"
    );


    /*
     * Display the existing history
     * immediately if available.
     */

    createCpuChart();


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
            safeCpu
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

function addCpuReading(cpu) {

    /*
     * Store the CPU value together
     * with the exact time it was received.
     *
     * NOTHING IS DELETED.
     */

    cpuHistory.push({

        value:
            cpu,

        time:
            new Date()

    });
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

    if (!canvas) {

        return;
    }


    /*
     * Every reading gets horizontal space.
     *
     * Example:
     *
     * 10 readings  = 1100px minimum
     * 50 readings  = 5000px
     * 100 readings = 10000px
     */

    const calculatedWidth =
        Math.max(
            MIN_CHART_WIDTH,
            cpuHistory.length *
                PIXELS_PER_POINT
        );


    canvas.style.width =
        calculatedWidth +
        "px";


    canvas.style.height =
        "400px";
}


/* ==========================================================
   CPU DATASET
========================================================== */

function createCpuDataset() {

    return {

        label:
            "CPU Utilization",


        data:
            cpuHistory.map(
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
            cpuHistory.map(
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
                        cpuHistory.map(
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
                        false,


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
                                true,

                            position:
                                "bottom",

                            align:
                                "start",

                            labels: {

                                usePointStyle:
                                    true,

                                boxWidth:
                                    25,

                                padding:
                                    25,

                                color:
                                    "#667085",

                                font: {

                                    size:
                                        12
                                }

                            }

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


                            callbacks: {

                                title:
                                    function (
                                        tooltipItems
                                    ) {

                                        const index =
                                            tooltipItems[0]
                                                .dataIndex;


                                        const point =
                                            cpuHistory[index];


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
                                            cpuHistory[index];


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
                                    false,


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
                                            cpuHistory[index];


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
     * Update ALL timestamps.
     */

    cpuChart.data.labels =
        cpuHistory.map(
            item =>
                item.time
        );


    /*
     * Update ALL CPU values.
     */

    cpuChart.data.datasets[0].data =
        cpuHistory.map(
            item =>
                item.value
        );


    /*
     * Update warning line.
     */

    cpuChart.data.datasets[1].data =
        cpuHistory.map(
            () =>
                WARNING_THRESHOLD
        );


    /*
     * Update critical line.
     */

    cpuChart.data.datasets[2].data =
        cpuHistory.map(
            () =>
                CRITICAL_THRESHOLD
        );


    /*
     * Redraw.
     */

    cpuChart.update(
        "none"
    );


    /*
     * Automatically move the scrollbar
     * to the newest reading.
     */

    const container =
        contentEl.querySelector(
            ".cpu-chart-container"
        );


    if (container) {

        container.scrollLeft =
            container.scrollWidth;
    }
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
