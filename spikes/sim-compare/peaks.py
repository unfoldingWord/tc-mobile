import sys,subprocess,array,json
d=subprocess.run(['ffmpeg','-v','error','-i',sys.argv[1],'-f','s16le','-ac','1','-ar','44100','-'],capture_output=True).stdout
a=array.array('h');a.frombytes(d[:len(d)//2*2])
r=44100
print(json.dumps({'seconds':round(len(a)/r,2),'perSecondPeak':[round(max(abs(x) for x in a[i:i+r])/32768,5) for i in range(0,len(a),r)]}))
