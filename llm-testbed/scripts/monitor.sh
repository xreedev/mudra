#!/system/bin/sh
# On-device live monitor for GPU / CPU / RAM while the LLM runs.
# Run from the laptop:  adb shell < scripts/monitor.sh
# (or paste the one-liner in README). Ctrl+C to stop.
PID=$(pidof com.llmtestbed)
if [ -z "$PID" ]; then echo "com.llmtestbed not running"; exit 1; fi
echo "pid=$PID  (8 cores => CPU% max 800)"
echo "time      GPU%   CPU%    RAM"
while true; do
  read b t < /sys/class/kgsl/kgsl-3d0/gpubusy 2>/dev/null
  if [ -z "$t" ] || [ "$t" -eq 0 ] 2>/dev/null; then g=0; else g=$((b*100/t)); fi
  line=$(top -b -n 1 -p "$PID" 2>/dev/null | tail -1)
  cpu=$(echo "$line" | awk '{print $9}')
  res=$(echo "$line" | awk '{print $6}')
  printf "%s  %3s%%  %5s%%  %6s\n" "$(date +%H:%M:%S)" "$g" "$cpu" "$res"
  sleep 1
done
