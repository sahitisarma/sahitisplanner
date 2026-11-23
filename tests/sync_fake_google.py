# Browser test of Calendar/Tasks/Drive sync against a fake Google. Run: python3 -m http.server 8765 (in repo root), then python3 tests/sync_fake_google.py
import asyncio, json, re, time, datetime
from urllib.parse import urlparse, parse_qs, unquote
from playwright.async_api import async_playwright
URL='http://localhost:8765/'
def now(): return datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3]+'Z'
TODAY=datetime.date.today()
TOM=TODAY+datetime.timedelta(days=1)
G={
 'cals':[{'id':'primary@x','summary':'Sahiti','backgroundColor':'#3D5DA8','primary':True,'accessRole':'owner'}],
 'events':{'primary@x':{'e1':{'id':'e1','summary':'Dentist','start':{'dateTime':f'{TOM}T10:00:00-05:00'},'end':{'dateTime':f'{TOM}T11:00:00-05:00'},'etag':'"1"','updated':now(),'status':'confirmed'}}},
 'lists':[{'id':'L1','title':'My Tasks'}],
 'tasks':{'L1':{'t1':{'id':'t1','title':'Pay rent','status':'needsAction','due':f'{TODAY}T00:00:00.000Z','updated':now()}}},
 'drive':{}, 'log':[]
}
seq=[100]
def nid(p): seq[0]+=1; return f'{p}{seq[0]}'
async def handler(route, req):
    u=urlparse(req.url); q=parse_qs(u.query); path=unquote(u.path); m=req.method
    body=None
    try: body=json.loads(req.post_data) if req.post_data and not 'upload' in u.path else req.post_data
    except Exception: body=req.post_data
    G['log'].append(f'{m} {path}')
    def ok(data=None, status=200):
        return route.fulfill(status=status, content_type='application/json', body=json.dumps(data) if data is not None else '', headers={'Access-Control-Allow-Origin':'*'})
    if 'userinfo' in path: return await ok({'email':'sahiti@example.com'})
    if path.endswith('/calendarList'): return await ok({'items':G['cals']})
    mm=re.match(r'.*/calendar/v3/calendars/([^/]+)/events(?:/([^/]+))?(/move)?$', path)
    if mm:
        cal, eid, mv = mm.groups(); evs=G['events'].setdefault(cal,{})
        if m=='GET' and not eid: return await ok({'items':list(evs.values())})
        if m=='GET': return await ok(evs[eid])
        if m=='POST' and mv:
            dest=q['destination'][0]; e=evs.pop(eid); G['events'].setdefault(dest,{})[eid]=e; return await ok(e)
        if m=='POST':
            if body['id'] in evs: return await ok({'error':{'message':'dup'}},409)
            e=dict(body); e['etag']='"1"'; e['updated']=now(); e['status']='confirmed'; evs[e['id']]=e; return await ok(e)
        if m=='PATCH': evs[eid].update(body); evs[eid]['etag']=f'"{seq[0]}"'; seq[0]+=1; return await ok(evs[eid])
        if m=='DELETE': evs.pop(eid,None); return await ok(None,204)
    if path.endswith('/users/@me/lists'): return await ok({'items':G['lists']})
    mm=re.match(r'.*/tasks/v1/lists/([^/]+)/tasks(?:/([^/]+))?$', path)
    if mm:
        lid,tid=mm.groups(); ts=G['tasks'].setdefault(lid,{})
        if m=='GET':
            since=q.get('updatedMin',[None])[0]
            items=[t for t in ts.values() if not since or t['updated']>=since]
            return await ok({'items':items})
        if m=='POST':
            t=dict(body); t['id']=nid('t'); t['updated']=now(); ts[t['id']]=t; return await ok(t)
        if m=='PATCH':
            ts[tid].update({k:v for k,v in body.items()}); ts[tid]['updated']=now(); return await ok(ts[tid])
        if m=='DELETE': ts.pop(tid,None); return await ok(None,204)
    if '/drive/v3/files' in path and 'upload' not in path:
        mm=re.match(r'.*/files/([^/]+)$', path)
        if mm: return await route.fulfill(status=200, content_type='application/json', body=G['drive'][mm.group(1)]['content'])
        return await ok({'files':[{'id':k} for k,v in G['drive'].items() if v['name']=='planner-data.json']})
    if '/upload/drive/v3/files' in path:
        mm=re.match(r'.*/files/([^/]+)$', path)
        if mm: G['drive'][mm.group(1)]['content']=req.post_data; return await ok({'id':mm.group(1)})
        data=req.post_data or ''
        if 'planner-data.json' in data:
            parts=data.split('\r\n\r\n',2); content=parts[2].rsplit('\r\n--',1)[0]
            fid=nid('f'); G['drive'][fid]={'name':'planner-data.json','content':content}; return await ok({'id':fid})
        fid=nid('a'); G['drive'][fid]={'name':'audio','content':''}; return await ok({'id':fid})
    return await ok({'error':{'message':'unmocked '+path}},404)

TOKENS={'n':0}
async def fake_worker(route, req):
    body=json.loads(req.post_data or '{}')
    if body.get('session')!='S3CRET': return await route.fulfill(status=401, content_type='application/json', body='{"error":"signed_out"}', headers={'Access-Control-Allow-Origin':'*'})
    TOKENS['n']+=1
    return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'access_token':f'AT{TOKENS["n"]}','expires_in':3600}), headers={'Access-Control-Allow-Origin':'*'})
async def device(b):
    ctx=await b.new_context(viewport={'width':1366,'height':1024})
    await ctx.route(re.compile(r'https://(www|tasks|openidconnect)\.googleapis\.com/.*'), handler)
    await ctx.route('https://auth.test.workers.dev/**', fake_worker)
    # Always-connected mode: only a server session, no access token yet
    await ctx.add_init_script("""if(!localStorage.getItem('sp-google-session')){localStorage.setItem('sp-google-session','S3CRET'); localStorage.setItem('sp-google-email','sahiti@example.com');}""")
    pg=await ctx.new_page()
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type in ('error','warning') else None)
    await pg.goto(URL); await pg.wait_for_timeout(600)
    await pg.evaluate("""async()=>{const m=await import('./js/model.js'); m.saveSettings({authServer:'https://auth.test.workers.dev'});}""")
    return pg, errs
async def run_sync(pg):
    await pg.evaluate("async()=>{const s=await import('./js/sync.js'); await s.run();}")
    await pg.wait_for_timeout(200)
    await pg.evaluate("async()=>{const s=await import('./js/sync.js'); await s.run();}")
async def J(pg, js): return await pg.evaluate(js)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        A,errA=await device(b)
        await run_sync(A)
        st=await J(A,"""async()=>{const s=await import('./js/store.js'); return {ev:s.all('events').map(e=>[e.id,e.summary,e.start]), items:s.all('items').map(i=>[i.id,i.title,i.done,i.due]), status:s.getStatus()}}""")
        print('1 PULL', json.dumps(st))
        # complete the Google task in the planner
        await J(A,"""async()=>{const s=await import('./js/store.js'); const m=await import('./js/model.js'); m.setDone(s.get('items','gt:t1'), true);}""")
        await A.wait_for_timeout(300); await run_sync(A)
        print('2 TASK COMPLETE ->google', G['tasks']['L1']['t1']['status'], '| tokens fetched from server:', TOKENS['n'])
        # Simulate the hour passing: access expires, the app must quietly get a new one
        await J(A, "localStorage.setItem('sp-google-token', JSON.stringify({access:'old', exp: Date.now()-1}))")
        # reopen in Google, rename it; move event in Google
        time.sleep(0.01)
        G['tasks']['L1']['t1'].update({'status':'needsAction','title':'Pay rent (Dec)','updated':now()}); G['tasks']['L1']['t1'].pop('completed',None)
        G['events']['primary@x']['e1'].update({'summary':'Dentist (moved)','start':{'dateTime':f'{TOM}T14:00:00-05:00'},'end':{'dateTime':f'{TOM}T15:00:00-05:00'},'etag':'"9"'})
        await run_sync(A)
        st=await J(A,"""async()=>{const s=await import('./js/store.js'); const i=s.get('items','gt:t1'); const e=s.get('events','g:primary@x:e1'); return [i.title,i.done, e.summary, new Date(e.start).getUTCHours()]}""")
        print('3 GOOGLE->planner', st, '| tokens fetched after expiry:', TOKENS['n'])
        print('   status:', (await J(A,"async()=>{const s=await import('./js/store.js'); return s.getStatus().sync}")))
        # create an event in planner, edit, then delete
        await J(A,"""async()=>{const E=await import('./js/events.js'); const D=await import('./js/dates.js'); window.__ev=E.createEvent({summary:'Lunch', calId:'primary@x', startKey:D.todayKey(), startTime:'12:00', endKey:D.todayKey(), endTime:'13:00'});}""")
        await run_sync(A)
        print('4 CREATE ->google', [ (k,v['summary']) for k,v in G['events']['primary@x'].items()])
        await J(A,"""async()=>{const E=await import('./js/events.js'); const s=await import('./js/store.js'); const D=await import('./js/dates.js'); const ev=s.get('events', window.__ev.id); E.updateEvent(ev,{summary:'Lunch w/ Ivy', calId:'primary@x', startKey:D.todayKey(), startTime:'12:30', endKey:D.todayKey(), endTime:'13:30'});}""")
        await run_sync(A)
        gid=[k for k in G['events']['primary@x'] if k.startswith('sp')][0]
        print('5 EDIT ->google', G['events']['primary@x'][gid]['summary'], G['events']['primary@x'][gid]['start'])
        # retry safety: insert same id again must not duplicate
        # new to-do goes to Google Tasks list when chosen
        await J(A,"""async()=>{const m=await import('./js/model.js'); m.saveSettings({newTaskList:'L1'}); m.newItem({section:'todos', title:'Book flights', gNew:true});}""")
        await A.wait_for_timeout(300); await run_sync(A)
        print('6 NEW TODO ->google', [t['title'] for t in G['tasks']['L1'].values()])
        # handwriting on device A, then device B joins via Drive
        await J(A,"""async()=>{const s=await import('./js/store.js'); s.put('ink',{id:'day:2026-11-23:notes', strokes:[{id:'s1',tool:'pen',color:'#000',w:2,pts:[1,1,.5,50,50,.5]}]});}""")
        await A.wait_for_timeout(300); await run_sync(A)
        B,errB=await device(b)
        await run_sync(B)
        stB=await J(B,"""async()=>{const s=await import('./js/store.js'); return {items:s.all('items').map(i=>[i.title,i.g?.taskId||null]), ink:s.all('ink').map(r=>r.id), ev:s.all('events').length}}""")
        print('7 DEVICE B', json.dumps(stB))
        titles=[t for t,_ in stB['items']]
        print('   duplicates?', len(titles)!=len(set(titles)))
        # delete event from planner
        await J(A,"""async()=>{const E=await import('./js/events.js'); const s=await import('./js/store.js'); E.deleteEvent(s.get('events', window.__ev.id));}""")
        await run_sync(A)
        print('8 DELETE ->google', [k for k in G['events']['primary@x']])
        print('status', await J(A,"async()=>{const s=await import('./js/store.js'); return s.getStatus()}"))
        print('errors A', errA[:5]); print('errors B', errB[:5])
        await b.close()
asyncio.run(main())
