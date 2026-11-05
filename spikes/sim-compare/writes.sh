#!/bin/zsh
# Timed write matrix; one target at a time. Raw results: raw/writes.jsonl
export PATH=$PATH:~/Library/Android/sdk/platform-tools
OUT=$S/raw/writes.jsonl; V=DCC9-12EC; P=org.unfoldingword.tcmobile; D=$S
capopen(){ adb -s $s shell am force-stop $P; adb -s $s shell am start -n $P/.MainActivity >/dev/null; sleep 6; node $D/cdp.mjs $s $P 'location.assign("/?harness=1");1' 15000 >/dev/null; sleep 5; }
caprun(){ local size=$1 where=$2 mode=$3 n=$4 dead=0
 capopen
 for i in $(seq 1 $n); do
  r=$(node $D/cdp.mjs $s $P "__sim.writeRun({size:$size,where:'$where',mode:'$mode',base64Read:true}).catch(e=>({error:String(e)}))" 900000)
  alive=$(adb -s $s shell pidof $P | tr -d '\r')
  echo "{\"target\":\"$s\",\"run\":$i,\"size\":$size,\"where\":\"$where\",\"mode\":\"$mode\",\"alive\":\"$alive\",\"r\":$r}" >> $OUT
  if [ -z "$alive" ] || echo "$r" | grep -qE 'disconnected|timeout|dead|"error"|exception'; then dead=$((dead+1)); adb -s $s logcat -d -t 200 | grep -E 'OutOfMemory|FATAL|lowmemorykiller|Killing|signal|am_kill' | tail -5 >> $S/raw/writes-crash-$s.log; [ $dead -ge 2 ] && break; capopen; fi
 done; }
exporun(){ local size=$1 where=$2 n=$3 m=$4 dead=0
 . $S/expo-android.sh
 restart_expo
 for i in $(seq 1 $n); do
  r=$(e write "size=$size&where=$where&mode=$m" 900)
  echo "{\"target\":\"$s\",\"run\":$i,\"size\":$size,\"where\":\"$where\",\"mode\":\"$m\",\"r\":$r}" >> $OUT
  if echo "$r" | grep -qE 'dead|timeout'; then dead=$((dead+1)); adb -s $s logcat -d -t 200 | grep -E 'OutOfMemory|FATAL|Killing|signal' | tail -5 >> $S/raw/writes-crash-$s.log; [ $dead -ge 2 ] && break; restart_expo; fi
 done; }
exposaf(){ local size=$1 n=$2 m=$3
 . $S/expo-android.sh
 restart_expo
 adb -s $s shell am start -a android.intent.action.VIEW -d "'expoproof://run?op=pick&id=p$size&initial=content%3A%2F%2Fcom.android.externalstorage.documents%2Fdocument%2F$V%253Atc-test'" $PX >/dev/null 2>&1; sleep 4; adb -s $s shell input tap 540 2274; sleep 2; adb -s $s shell input tap 879 1388; sleep 3
 for i in $(seq 1 $n); do r=$(e write "size=$size&where=saf&mode=$m" 900); echo "{\"target\":\"$s\",\"run\":$i,\"size\":$size,\"where\":\"saf\",\"mode\":\"$m\",\"r\":$r}" >> $OUT; done; }
s=emulator-5570; C=file:///storage/$V/Android/data/$P/files
for sz in 9600000 106000000; do
 caprun $sz internal chunked 5; caprun $sz internal oneshot 5; exporun $sz internal 5 whole; exporun $sz internal 5 handle
 caprun $sz $C chunked 5; caprun $sz $C oneshot 5; exposaf $sz 5 whole; exposaf $sz 5 handle
done
s=emulator-5572
for sz in 9600000 106000000; do caprun $sz internal chunked 5; caprun $sz internal oneshot 5; exporun $sz internal 5 whole; exporun $sz internal 5 handle; done
echo MATRIX-DONE >> $OUT
