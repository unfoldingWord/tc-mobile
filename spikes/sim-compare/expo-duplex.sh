s=$1; tag=$2; . $S/expo-android.sh
echo "--- A1 fresh: record 5 s then play"; restart_expo; e mode; e startRec; sleep 5; e status; r=$(e stopRec); echo "$r"; pull_peaks "$r" $S/raw/expo-$tag-a1.m4a; e playTake; sleep 2; e status; sleep 2; e status; e stopPlay
echo "--- A2 fresh: tone 30 s, record at +3 s"; restart_expo; e mode; e playTone seconds=30; sleep 3; e status; e startRec; for i in 1 2 3 4 5 6; do sleep 1; e status; done; r=$(e stopRec); echo "$r"; pull_peaks "$r" $S/raw/expo-$tag-a2.m4a; e status; sleep 2; e status; e stopPlay
echo "--- A3 fresh: record, tone (earlier-take stand-in) at +3 s"; restart_expo; e mode; e startRec; sleep 3; e status; e playTone seconds=8; for i in 1 2 3 4; do sleep 1; e status; done; r=$(e stopRec); echo "$r"; pull_peaks "$r" $S/raw/expo-$tag-a3.m4a; e status; e stopPlay
echo "--- repeat-capture control: three plain takes in one process"; restart_expo; e mode; for i in 1 2 3; do e startRec >/dev/null; sleep 4; r=$(e stopRec); pull_peaks "$r" $S/raw/expo-$tag-r$i.m4a; sleep 1; done
echo "HAL tone-source end: $(adb -s $s logcat -d | grep -c "creating a tone source")"
