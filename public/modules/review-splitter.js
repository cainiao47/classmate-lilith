export function boundedRatio(value, width, leftMin, rightMin) {
  const available = width - 14;
  if (available < leftMin + rightMin) return null;
  return Math.max(leftMin / available, Math.min(1 - rightMin / available, Number.isFinite(Number(value)) ? Number(value) : .6));
}
export function installReviewSplitters(doc = document, host = window) {
  for (const [selector,key,label,initial,leftMin,rightMin,breakpoint] of [
    ['.review-core-grid','review-columns','调整正文与疑点栏宽度',.6,520,300,1180],
    ['.compare-grid','review-compare','调整原文与校订稿宽度',.5,260,260,800]
  ]) {
    const grid = doc.querySelector(selector);
    if (!grid || grid.querySelector(':scope > .review-splitter')) continue;
    const bar = doc.createElement('div'); bar.className='review-splitter'; bar.tabIndex=0;
    bar.setAttribute('role','separator'); bar.setAttribute('aria-orientation','vertical'); bar.setAttribute('aria-label',label);
    bar.title=label+'；方向键微调，双击复位'; grid.insertBefore(bar,grid.children[1]);
    let ratio=initial, dragging=null;
    try { const stored=host.localStorage.getItem(key); if(stored!==null&&Number.isFinite(Number(stored)))ratio=Number(stored); } catch {}
    const persist=()=>{try{host.localStorage.setItem(key,String(ratio));}catch{}};
    const render=()=>{
      const width=grid.getBoundingClientRect().width, value=boundedRatio(ratio,width,leftMin,rightMin);
      const active=value!==null&&host.innerWidth>breakpoint&&!(key==='review-compare'&&doc.body.classList.contains('review-edit-only'));
      grid.dataset.splitActive=String(active); bar.hidden=!active;
      if(!active)return;
      grid.style.setProperty('--split-columns',`${value}fr 14px ${1-value}fr`);
      for(const [name,number] of [['min',leftMin/(width-14)],['max',1-rightMin/(width-14)],['now',value]])bar.setAttribute('aria-value'+name,String(Math.round(number*100)));
    };
    bar.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=event.pointerId;bar.setPointerCapture(event.pointerId);bar.focus();event.preventDefault();});
    bar.addEventListener('pointermove',event=>{
      if(dragging!==event.pointerId)return;
      const rect=grid.getBoundingClientRect(),next=boundedRatio((event.clientX-rect.left-7)/(rect.width-14),rect.width,leftMin,rightMin);
      if(next!==null){ratio=next;render();}
    });
    const finish=()=>{dragging=null;persist();};
    for(const name of ['pointerup','pointercancel','lostpointercapture'])bar.addEventListener(name,finish);
    bar.addEventListener('dblclick',()=>{ratio=initial;render();persist();});
    bar.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;
      event.preventDefault();const current=boundedRatio(ratio,grid.clientWidth,leftMin,rightMin);if(current===null)return;
      ratio=event.key==='Home'?initial:boundedRatio(current+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?.05:.01),grid.clientWidth,leftMin,rightMin);
      render();persist();
    });
    new host.ResizeObserver(render).observe(grid);
    new host.MutationObserver(render).observe(doc.body,{attributes:true,attributeFilter:['class']});
    host.addEventListener('resize',render);render();
  }
}
if(typeof document!=='undefined')installReviewSplitters();
