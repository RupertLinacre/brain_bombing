async page => {
  const browser=page.context().browser(),results=[];
  const endpoint='https://keep-it-going-relay.robinlinacre.workers.dev/ice';
  const assert=(value,message)=>{if(!value)throw Error(message)};
  for(const mode of ['auto','relay','tls443','broker-outage']){
    const contexts=await Promise.all([browser.newContext(),browser.newContext({hasTouch:true,viewport:{width:390,height:844}})]);
    const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));
    let errors=0;const statuses=[];
    try{
      for(const c of contexts){
        await c.addInitScript(mode=>{
          const Native=window.RTCPeerConnection;window.qaPCs=[];
          window.RTCPeerConnection=class extends Native{
            constructor(config,...rest){
              const hasTurn=config?.iceServers?.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u)));
              if(hasTurn&&(mode==='relay'||mode==='tls443')){
                config={...config,iceTransportPolicy:'relay'};
                if(mode==='tls443')config.iceServers=config.iceServers.map(s=>({...s,urls:(Array.isArray(s.urls)?s.urls:[s.urls]).filter(u=>/^turns:.*:443\?transport=tcp$/.test(u))})).filter(s=>s.urls.length);
              }
              super(config,...rest);window.qaPCs.push(this);
            }
          };
        },mode);
        if(mode==='broker-outage')await c.route(endpoint,r=>r.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'http://localhost:5198','Content-Type':'application/json'},body:'{"error":"Relay unavailable"}'}));
      }
      for(const p of [host,guest]){
        p.on('pageerror',()=>errors++);
        p.on('response',r=>{if(r.url()===endpoint)statuses.push(r.status())});
        await p.goto('http://localhost:5198/');
        await p.evaluate(async()=>{
          const {Engine}=await import('/src/game/engine.ts'),{Renderer}=await import('/src/game/renderer.ts');
          const step=Engine.prototype.step;Engine.prototype.step=function(...args){window.qaGame=this;return step.apply(this,args)};
          const draw=Renderer.prototype.draw;Renderer.prototype.draw=function(...args){window.qaView=args[0];return draw.apply(this,args)};
        });
      }
      await host.locator('#player-name').fill('Host');await guest.locator('#player-name').fill('Guest');
      await host.getByRole('button',{name:'Create room',exact:true}).click();
      await host.waitForFunction(()=>/^[A-Z2-9]{4}$/.test(document.querySelector('#invite-code')?.textContent),null,{timeout:25000});
      const warning=await host.locator('#connection-status').innerText();
      if(mode==='broker-outage')assert(warning.includes('Trying a direct connection'),'Broker outage was hidden');
      const code=await host.locator('#invite-code').innerText();
      await guest.getByRole('button',{name:'Join a friend',exact:true}).click();await guest.locator('#room-code').fill(code);await guest.getByRole('button',{name:'Join room',exact:true}).click();
      await host.getByRole('button',{name:'Start battle'}).click({timeout:35000});
      await host.waitForFunction(()=>window.qaGame?.readyIn===0);await guest.waitForFunction(()=>window.qaView?.readyIn===0&&document.querySelector('#mode-label').textContent.includes('ONLINE'));
      const routes=[];
      for(const p of [host,guest])routes.push(await p.evaluate(async()=>{
        const pc=window.qaPCs.find(pc=>pc.connectionState==='connected');
        if(!pc)throw Error('No connected peer connection');
        const report=await pc.getStats(),stats=[...report.values()];
        const transport=stats.find(s=>s.type==='transport'&&s.selectedCandidatePairId);
        const pair=transport?report.get(transport.selectedCandidatePairId):stats.find(s=>s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated);
        const local=report.get(pair.localCandidateId),remote=report.get(pair.remoteCandidateId);
        return {route:local?.candidateType==='relay'||remote?.candidateType==='relay'?'relay':'direct',protocol:local?.protocol,relayProtocol:local?.relayProtocol,policy:pc.getConfiguration().iceTransportPolicy};
      }));
      if(mode==='relay'||mode==='tls443')assert(routes.every(r=>r.route==='relay'),'Forced relay connected directly');
      if(mode==='tls443')assert(routes.every(r=>r.relayProtocol==='tls'),'TLS-443 test used another transport');
      if(mode==='auto')assert(routes.every(r=>r.policy==='all'),'Production is forcing relay');
      await host.evaluate(()=>{
        const g=window.qaGame;g.map=Array.from({length:11},(_,y)=>Array.from({length:15},(_,x)=>!x||!y||x===14||y===10?1:0));
        g.brains=[{id:9001,x:12,y:9,owner:1,question:{expression:'7+5',short:'7+5',choices:['11','12','13','14'],correct:1},rejected:[],retryAt:0}];
      });
      await guest.waitForFunction(()=>window.qaView.brains.some(b=>b.id===9001));
      await guest.keyboard.press('ArrowLeft');await guest.waitForTimeout(240);
      await guest.waitForFunction(()=>document.querySelectorAll('[data-answer]').length===4);
      await guest.locator('[data-answer="1"]').click();await host.waitForFunction(()=>window.qaGame.players[1].solved===1);
      await guest.keyboard.press('ArrowLeft');await guest.waitForTimeout(230);await guest.keyboard.press('Space');
      await host.waitForFunction(()=>window.qaGame.bombs.some(b=>b.owner===1));await guest.waitForFunction(()=>window.qaView.bombs.some(b=>b.owner===1));
      const privacy=await guest.evaluate(()=>!JSON.stringify(window.qaView).includes('"correct"'));assert(privacy,'Private correct answer leaked');
      assert(statuses.length===2&&statuses.every(s=>s===(mode==='broker-outage'?503:200)),'Both players did not fetch credentials');
      assert(errors===0,'Browser reported an uncaught error');
      results.push({mode,statuses,routes,solved:1,bombShared:true,privacy,errors});
      if(mode==='tls443')await guest.screenshot({path:'output/playwright/turn-tls443-mobile.png',fullPage:true});
    }finally{for(const c of contexts)await c.close()}
  }
  return results;
}
