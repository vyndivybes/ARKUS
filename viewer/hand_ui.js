import {clampHandPanelPosition} from './hand_gestures.js';

// Explicitly allowlisted ARKUS UI actions. Hand tracking never generates DOM
// clicks or pointer events, and cannot interact with operating-system windows.
export function createHandUI({source,notes,cursor,elementAt,viewport,onSelect}){
  let drag=null;
  const xy=point=>{
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
    const size=viewport();
    return {x:Math.min(size.width,Math.max(0,(1-point.x)*size.width)),
            y:Math.min(size.height,Math.max(0,point.y*size.height))};
  };
  function sample(observation){
    const pt=xy(observation?.point);
    if(!pt){cursor.hidden=true;return;}
    cursor.hidden=false;cursor.style.left=Math.round(pt.x)+'px';cursor.style.top=Math.round(pt.y)+'px';
    cursor.dataset.hand=observation.kind;
  }
  function action(event){
    if(!event||event.type==='release'){
      drag=null;return 'released';
    }
    const point=xy(event.point);
    if(!point)return 'ignored';
    if(event.type==='pinch'){
      const hit=elementAt(point.x,point.y);
      if(hit?.matches?.('button.note') && notes.contains(hit) && hit.dataset?.nodeId){
        onSelect(hit.dataset.nodeId);
        return 'note selected';
      }
      return 'pinch outside notes';
    }
    if(event.type==='grab'){
      if(source.hidden)return 'source panel closed';
      const hit=elementAt(point.x,point.y);
      const rect=source.getBoundingClientRect();
      const inHeading=point.x>=rect.left&&point.x<=rect.left+rect.width
        &&point.y>=rect.top&&point.y<=rect.top+82;
      if(inHeading&&hit&&source.contains(hit)&&!hit.closest?.('.close')){
        drag={offsetX:point.x-rect.left,offsetY:point.y-rect.top};
        return 'source grabbed';
      }
      return 'grab outside source heading';
    }
    if(event.type==='move'&&drag&&!source.hidden){
      const bounds=source.getBoundingClientRect();
      const place=clampHandPanelPosition(
        point.x-drag.offsetX,point.y-drag.offsetY,
        viewport(),{width:bounds.width,height:bounds.height},
      );
      source.style.left=place.left+'px';source.style.top=place.top+'px';source.style.right='auto';
      return 'source moved';
    }
    return 'ignored';
  }
  function stop(){drag=null;cursor.hidden=true;}
  return {sample,action,stop};
}
