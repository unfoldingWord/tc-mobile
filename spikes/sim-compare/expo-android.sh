# source me: e <op> [query]  runs one op on $s and prints its result line; restart_expo restarts.
zmodload zsh/datetime
PX=org.unfoldingword.tcmobile.expoproof
restart_expo(){ echo "HAL tone-source before restart: $(adb -s $s logcat -d | grep -c "creating a tone source")"; adb -s $s shell am force-stop $PX; adb -s $s logcat -c; adb -s $s shell am start -n $PX/.MainActivity >/dev/null; sleep 4; }
_n=0
e(){ _n=$((_n+1)); local id=x${EPOCHREALTIME/./} q=""; [ -n "$2" ] && q="&$2"; adb -s $s shell am start -a android.intent.action.VIEW -d "\"expoproof://run?op=$1&id=$id$q\"" $PX >/dev/null 2>&1
 local to=${3:-60}; local t=0; while [ $t -lt $((to*2)) ]; do l=$(adb -s $s logcat -d -s ReactNativeJS:I | grep "\"id\":\"$id\"" | grep -v '"start":true' | tail -1); [ -n "$l" ] && { echo "$l" | sed 's/.*SIM1921 //'; return; }; [ -z "$(adb -s $s shell pidof $PX | tr -d '\r')" ] && { echo "{\"dead\":true,\"op\":\"$1\"}"; return; }; sleep 0.5; t=$((t+1)); done; echo "{\"timeout\":true,\"op\":\"$1\"}"; }
pull_peaks(){ local u=$(echo "$1" | sed -E 's/.*"uri":"file:\/\/([^"]*)".*/\1/'); adb -s $s pull "$u" $2 >/dev/null && python3 $S/peaks.py $2; }
