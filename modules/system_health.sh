#!/bin/bash


# ============================================================
# GET CPU USAGE VALUE
# ============================================================

get_cpu_usage_value() {

    CPU_IDLE=$(top -bn1 | awk -F',' '
        /Cpu\(s\)/ {
            for (i = 1; i <= NF; i++) {

                if ($i ~ /id/) {

                    gsub(/[^0-9.]/, "", $i)

                    print $i

                    exit
                }
            }
        }
    ')


    # Make sure a value was returned

    if [[ -z "$CPU_IDLE" ]]; then

        echo "0"

        return 1

    fi


    # Calculate CPU usage

    awk -v idle="$CPU_IDLE" '
        BEGIN {

            usage = 100 - idle

            if (usage < 0)
                usage = 0

            if (usage > 100)
                usage = 100

            printf "%.1f\n", usage
        }
    '
}


# ============================================================
# CPU USAGE TERMINAL DISPLAY
# ============================================================

cpu_usage() {

    CPU_USAGE=$(get_cpu_usage_value)


    clear

    echo "========================================================"
    echo "                     CPU USAGE"
    echo "========================================================"

    echo

    printf "Current CPU Usage: %.1f%%\n" "$CPU_USAGE"

    echo


    # Determine CPU status

    if awk -v cpu="$CPU_USAGE" '
        BEGIN {
            exit !(cpu >= 80)
        }
    '
    then

        echo "CPU Status: HIGH"


    elif awk -v cpu="$CPU_USAGE" '
        BEGIN {
            exit !(cpu >= 50)
        }
    '
    then

        echo "CPU Status: MODERATE"


    else

        echo "CPU Status: NORMAL"

    fi


    echo

    read -rp "Press Enter to return..."
}


# ============================================================
# SYSTEM HEALTH MENU
# ============================================================

system_health_menu() {

    while true; do

        clear

        echo "========================================================"
        echo "                    SYSTEM HEALTH"
        echo "========================================================"

        echo

        echo "1. CPU Usage"
        echo "2. Memory Usage"
        echo "3. Disk Usage"
        echo "4. Load Average"
        echo "5. Uptime"
        echo "6. Back"

        echo

        read -rp "Enter your choice: " choice


        case "$choice" in

            1)

                cpu_usage

                ;;


            2)

                clear

                echo "MEMORY USAGE"

                echo

                echo "Feature under development."

                echo

                read -rp "Press Enter to return..."

                ;;


            3)

                clear

                echo "DISK USAGE"

                echo

                echo "Feature under development."

                echo

                read -rp "Press Enter to return..."

                ;;


            4)

                clear

                echo "LOAD AVERAGE"

                echo

                echo "Feature under development."

                echo

                read -rp "Press Enter to return..."

                ;;


            5)

                clear

                echo "UPTIME"

                echo

                echo "Feature under development."

                echo

                read -rp "Press Enter to return..."

                ;;


            6)

                return

                ;;


            *)

                echo

                echo "Invalid choice."

                read -rp "Press Enter to continue..."

                ;;

        esac

    done
}


# ============================================================
# STANDALONE EXECUTION
# ============================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    system_health_menu
fi

