import json,sys,statistics as st,collections
g=collections.defaultdict(list);other=collections.Counter()
txt=open(sys.argv[1]).read()
dec=json.JSONDecoder();i=0
recs=[]
for line in txt.replace('\n→',' →').split('\n'):
    if line.startswith('{'):
        try: recs.append(json.loads(line))
        except Exception as e: other['UNPARSED '+line[:150]]+=1
for d in recs:
    r=d['r']
    if isinstance(r.get('r'),dict): r=r['r']
    k=(d['target'][-2:]=='70' and 'api36' or 'api29',d['size'],('card' if d['where'].startswith('file') else d['where']),r.get('stack','cap?') if 'stack' in r else '?',d.get('mode'))
    g[k].append(r)
def f(v):
    v=[x for x in v if x is not None]
    return f"{st.median(v):.0f} [{min(v)}-{max(v)}] n={len(v)}" if v else '-'
for k in sorted(g,key=str):
    v=g[k]
    print(k,'runs',len(v))
    print('   write',f([x.get('writeMs') for x in v]),'| enc',f([x.get('encodeMs') for x in v]),'| fetch',f([x.get('fetchReadMs') for x in v]),'| b64',f([x.get('base64ReadMs') for x in v]),'| hrd',f([x.get('handleReadMs') for x in v]),'| whole',f([x.get('wholeReadMs') for x in v]))
    print('   crc',set((x.get('crcOk',x.get('fetchCrcOk')),x.get('base64CrcOk'),x.get('wholeCrcOk')) for x in v))
    for key in ('writeError','base64ReadError','wholeReadError','error','dead','disconnected','timeout','exception'):
        e=[str(x[key])[:170] for x in v if key in x]
        if e: print('   ',key,len(e),e[0])
print(other)
